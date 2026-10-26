import { createAdapterFactory } from '@better-auth/core/db/adapter'

/**
 * Better Auth database adapter that talks to Postgres through Supabase's
 * PostgREST API with the service-role key.
 *
 * Why not a SQL driver: plain HTTP works identically on Node and Cloudflare
 * Workers (no TCP sockets, no connection pooling, no Hyperdrive), and the
 * ba_* tables are only reachable with the service role anyway.
 *
 * Column names are snake_case; Better Auth's `fields` option in ./index.ts
 * maps its camelCase field names onto them, so this adapter only ever sees
 * the database names.
 */

interface PostgrestAdapterConfig {
  url: string
  serviceRoleKey: string
}

type Clause = {
  field: string
  value: unknown
  operator?: string
  connector?: 'AND' | 'OR'
  mode?: 'sensitive' | 'insensitive'
}

/** PostgREST filter values inside `in.(...)` / `or=(...)` must be quoted when they contain reserved chars. */
function quote(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  const s = String(value)
  return /[,.:()"\\\s]/.test(s) || s === '' ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s
}

function likeEscape(value: string): string {
  return value.replace(/[\\%_*]/g, (c) => `\\${c}`)
}

/** Returns [column, "operator.value"]; joined with a dot inside `or=(...)`, or used as `column=operator.value`. */
function clauseToFilter(c: Clause, grouped: boolean): [string, string] {
  const { field, operator = 'eq', mode } = c
  // Scalar values are only quoted inside or=(...) groups; plain `col=op.value` filters take them verbatim.
  const scalar = (v: unknown) => (grouped ? quote(v) : v instanceof Date ? v.toISOString() : String(v))
  const insensitive = mode === 'insensitive' && typeof c.value === 'string'
  const value = c.value
  switch (operator) {
    case 'in':
      return [field, `in.(${(value as unknown[]).map(quote).join(',')})`]
    case 'not_in':
      return [field, `not.in.(${(value as unknown[]).map(quote).join(',')})`]
    case 'contains':
      return [field, `ilike.${scalar(`*${likeEscape(String(value))}*`)}`]
    case 'starts_with':
      return [field, `ilike.${scalar(`${likeEscape(String(value))}*`)}`]
    case 'ends_with':
      return [field, `ilike.${scalar(`*${likeEscape(String(value))}`)}`]
    case 'ne':
      return [field, value === null ? 'not.is.null' : `neq.${scalar(value)}`]
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return [field, `${operator}.${scalar(value)}`]
    default:
      if (value === null) return [field, 'is.null']
      return [field, insensitive ? `ilike.${scalar(likeEscape(String(value)))}` : `eq.${scalar(value)}`]
  }
}

/** Builds URL search params. AND clauses become separate params; OR clauses one `or=(...)` group. */
function buildFilters(where: Clause[] | undefined): URLSearchParams {
  const params = new URLSearchParams()
  if (!where?.length) return params

  const ands: Clause[] = []
  const ors: Clause[] = []
  where.forEach((c, i) => (i > 0 && c.connector === 'OR' ? ors : ands).push(c))
  // First clause of an OR chain belongs to the OR group, e.g. [a, b OR, c OR] -> a OR b OR c
  if (ors.length && ands.length === 1) {
    ors.unshift(ands.pop() as Clause)
  }

  for (const c of ands) {
    const [field, filter] = clauseToFilter(c, false)
    params.append(field, filter)
  }
  if (ors.length) {
    params.append('or', `(${ors.map((c) => clauseToFilter(c, true).join('.')).join(',')})`)
  }
  return params
}

export const postgrestAdapter = (config: PostgrestAdapterConfig) =>
  createAdapterFactory({
    config: {
      adapterId: 'supabase-postgrest',
      adapterName: 'Supabase PostgREST Adapter',
      usePlural: false,
      supportsJSON: true,
      supportsDates: false, // ISO strings in, strings out (Better Auth revives them)
      supportsBooleans: true,
      supportsArrays: false,
      transaction: false, // PostgREST has no multi-request transactions
    },
    adapter: ({ getFieldName }) => {
      const base = `${config.url.replace(/\/$/, '')}/rest/v1`
      const headers = (extra?: Record<string, string>): HeadersInit => ({
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        'Content-Type': 'application/json',
        ...extra,
      })

      async function request(path: string, init: RequestInit, errorContext: string): Promise<Response> {
        const started = Date.now()
        const res = await fetch(`${base}/${path}`, init)
        // Slow calls and 429/5xx are logged (searchable in Workers observability) so Supabase limits show up early.
        const ms = Date.now() - started
        if (ms >= 800 || res.status === 429 || res.status >= 500) {
          console.warn(JSON.stringify({ evt: res.status >= 500 || res.status === 429 ? 'dependency_error' : 'dependency_slow', dep: 'supabase', op: `auth.${errorContext}`, ms, status: res.status }))
        }
        if (!res.ok) {
          throw new Error(`[auth] ${errorContext} failed: ${res.status} ${await res.text()}`)
        }
        return res
      }

      function query(model: string, where: Clause[] | undefined, extra?: Record<string, string>): string {
        const params = buildFilters(where)
        for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
        const qs = params.toString()
        return qs ? `${model}?${qs}` : model
      }

      return {
        async create({ model, data }) {
          const res = await request(
            model,
            { method: 'POST', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(data) },
            `create ${model}`
          )
          const rows = await res.json()
          return rows[0]
        },

        async findOne({ model, where }) {
          const res = await request(
            query(model, where as Clause[], { limit: '1' }),
            { headers: headers() },
            `findOne ${model}`
          )
          const rows = await res.json()
          return rows[0] ?? null
        },

        async findMany({ model, modelKey = model, where, limit, sortBy, offset }) {
          const extra: Record<string, string> = {}
          if (limit !== undefined) extra.limit = String(limit)
          if (offset) extra.offset = String(offset)
          // where-clause fields arrive already mapped to column names; sortBy does not
          if (sortBy) extra.order = `${getFieldName({ model: modelKey, field: sortBy.field })}.${sortBy.direction}`
          const res = await request(
            query(model, where as Clause[] | undefined, extra),
            { headers: headers() },
            `findMany ${model}`
          )
          return res.json()
        },

        async count({ model, where }) {
          const res = await request(
            query(model, where as Clause[] | undefined, { select: 'id', limit: '1' }),
            { headers: headers({ Prefer: 'count=exact' }) },
            `count ${model}`
          )
          // content-range: 0-0/42  (or */0 when empty)
          const total = res.headers.get('content-range')?.split('/')[1]
          return total ? Number(total) : 0
        },

        async update({ model, where, update }) {
          if (!where.length) return null
          const res = await request(
            query(model, where as Clause[]),
            { method: 'PATCH', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(update) },
            `update ${model}`
          )
          const rows = await res.json()
          return rows[0] ?? null
        },

        async updateMany({ model, where, update }) {
          if (!where.length) return 0
          const res = await request(
            query(model, where as Clause[]),
            { method: 'PATCH', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(update) },
            `updateMany ${model}`
          )
          return (await res.json()).length
        },

        async delete({ model, where }) {
          if (!where.length) return
          await request(query(model, where as Clause[]), { method: 'DELETE', headers: headers() }, `delete ${model}`)
        },

        async deleteMany({ model, where }) {
          const res = await request(
            query(model, where as Clause[]),
            { method: 'DELETE', headers: headers({ Prefer: 'return=representation' }) },
            `deleteMany ${model}`
          )
          return (await res.json()).length
        },
      }
    },
  })
