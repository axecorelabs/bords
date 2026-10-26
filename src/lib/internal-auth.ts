import { timingSafeEqual } from 'crypto'

/** True when the request carries `Authorization: Bearer <INTERNAL_API_SECRET>`. */
export function isInternalRequest(request: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
