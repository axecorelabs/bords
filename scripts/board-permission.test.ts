/** npx tsx scripts/board-permission.test.ts */
// The module creates a real Supabase client when imported; give it placeholders (nothing is ever contacted).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:1'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test'
import type { Db } from '../src/lib/board-permission'
let resolveBoardPermission: typeof import('../src/lib/board-permission').resolveBoardPermission

let failures = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); if (!ok) failures++ }

type Rows = Record<string, any[]>
/** A fake Supabase client: tables are arrays, filters are applied, and any table can be made to error. */
function fakeDb(rows: Rows, failing: string[] = []): Db {
  return {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = []
      let limit = Infinity
      const run = () => {
        if (failing.includes(table)) return { data: null, error: { message: `simulated outage on ${table}` } }
        return { data: (rows[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, limit), error: null }
      }
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
        in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q),
        limit: (n: number) => ((limit = n), q),
        maybeSingle: async () => { const r = run(); return r.error ? r : { data: r.data![0] ?? null, error: null } },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      }
      return q
    },
  } as unknown as Db
}
const throws = async (fn: () => Promise<unknown>) => { try { await fn(); return false } catch { return true } }

async function main() {
  ;({ resolveBoardPermission } = await import('../src/lib/board-permission'))
  const base: Rows = {
    bords: [
      { id: 'b1', local_board_id: 'personal-board', owner_id: 'owner1', organization_id: null, context_type: 'personal' },
      { id: 'b2', local_board_id: 'org-board', owner_id: 'owner1', organization_id: 'org1', context_type: 'organization' },
    ],
    bord_access_list: [{ bord_id: 'b1', user_id: 'sharedEditor', permission: 'edit' }, { bord_id: 'b1', user_id: 'sharedViewer', permission: 'view' }],
    organizations: [{ id: 'org1', owner_id: 'orgOwner' }],
    employee_memberships: [
      { organization_id: 'org1', user_id: 'orgAdmin', role: 'admin' },
      { organization_id: 'org1', user_id: 'orgMember', role: 'member' },
      { organization_id: 'org1', user_id: 'owner1', role: 'member' },
    ],
    board_documents: [{ local_board_id: 'legacy-board', owner_id: 'legacyOwner' }],
    yjs_documents: [{ board_id: 'synced-board', last_modified_by: 'syncer' }],
  }
  const db = fakeDb(base)
  const perm = (board: string, user: string) => resolveBoardPermission(board, user, db)

  console.log('rules (unchanged behaviour)')
  check('the bord owner is owner', (await perm('personal-board', 'owner1')) === 'owner')
  check('an access-list editor can edit', (await perm('personal-board', 'sharedEditor')) === 'edit')
  check('an access-list viewer can only view', (await perm('personal-board', 'sharedViewer')) === 'view')
  check('a stranger has no access', (await perm('personal-board', 'stranger')) === null)
  check('the org owner can edit an org board', (await perm('org-board', 'orgOwner')) === 'edit')
  check('an org admin can edit an org board', (await perm('org-board', 'orgAdmin')) === 'edit')
  check('an ordinary org member can view an org board', (await perm('org-board', 'orgMember')) === 'view')
  check('a non-member has no access to an org board', (await perm('org-board', 'stranger')) === null)
  check('a brand-new board (nobody has it) belongs to whoever opens it first', (await perm('new-board', 'anyone')) === 'owner')
  check('a legacy board is only for its owner', (await perm('legacy-board', 'legacyOwner')) === 'owner' && (await perm('legacy-board', 'stranger')) === null)
  check('a synced-but-unregistered board is only for its last editor', (await perm('synced-board', 'syncer')) === 'owner' && (await perm('synced-board', 'stranger')) === null)

  console.log('\nfail closed: a database error must never turn into a permissive answer')
  for (const table of ['bords', 'bord_access_list', 'board_documents', 'yjs_documents', 'organizations', 'employee_memberships']) {
    const broken = fakeDb(base, [table])
    const cases: Array<[string, string]> = [
      ['new-board', 'anyone'], // the dangerous one: "no row" means "you can claim it"
      ['personal-board', 'stranger'],
      ['org-board', 'stranger'],
      ['legacy-board', 'stranger'],
      ['synced-board', 'stranger'],
    ]
    let neverPermissive = true
    let sawThrow = false
    for (const [board, user] of cases) {
      try {
        const r = await resolveBoardPermission(board, user, broken)
        // answering at all is only acceptable if it was NOT affected by the broken table and is not permissive for strangers
        if (r !== null && user !== 'anyone') neverPermissive = false
        if (board === 'new-board' && r === 'owner' && ['bords', 'board_documents', 'yjs_documents'].includes(table)) neverPermissive = false
      } catch { sawThrow = true }
    }
    check(`with "${table}" failing: no one is ever handed access, and lookups that need it throw`, neverPermissive && sawThrow)
  }
  check('specifically: a failed lookup for an unsaved board throws instead of returning "owner"', await throws(() => resolveBoardPermission('new-board', 'attacker', fakeDb(base, ['yjs_documents']))))
  check('...and when the board table itself fails', await throws(() => resolveBoardPermission('new-board', 'attacker', fakeDb(base, ['bords']))))
}
main().catch((e) => { failures++; console.error('TEST ERROR:', e) }).finally(() => { console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); process.exit(failures ? 1 : 0) })
