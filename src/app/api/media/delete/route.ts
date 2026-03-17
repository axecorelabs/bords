import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { deleteFromWasabi, extractKeyFromUrl } from '@/lib/wasabi'

/**
 * DELETE /api/media/delete
 * Body: { url: string } or { key: string }
 *
 * Deletes an object from Wasabi. Only authenticated users can delete.
 * The key includes the userId path segment, so we verify ownership.
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    let key: string | null = body.key || null

    // If a full URL was provided, extract the key
    if (!key && body.url) {
      key = extractKeyFromUrl(body.url)
    }

    if (!key) {
      return NextResponse.json({ error: 'No key or url provided' }, { status: 400 })
    }

    // Verify the key belongs to this user (key format: folder/userId/filename)
    const segments = key.split('/')
    if (segments.length < 3 || segments[1] !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await deleteFromWasabi(key)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[media/delete] Error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
