/**
 * Run work after the response is sent without letting it be cancelled.
 * On Cloudflare Workers a dangling promise is killed when the response
 * finishes, so it has to go through ctx.waitUntil; elsewhere it just runs.
 */
export async function runInBackground(work: Promise<unknown>): Promise<void> {
  const guarded = work.catch((err) => console.error('[background] task failed:', err))
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    getCloudflareContext().ctx.waitUntil(guarded)
  } catch {
    // not on Workers: the promise keeps running on its own
  }
}
