import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { uploadToWasabi } from '@/lib/wasabi'
import { randomUUID } from 'crypto'
import path from 'path'

// File size limits
const MAX_IMAGE_SIZE = 10 * 1024 * 1024  // 10 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024  // 50 MB

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']

const EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
}

/**
 * POST /api/media/upload
 * Accepts a FormData body with:
 *   - file: the file to upload
 *   - folder: "media" | "backgrounds" (defaults to "media")
 *
 * Returns: { url: string, key: string }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const folder = (formData.get('folder') as string) || 'media'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const contentType = file.type
    const isImage = ALLOWED_IMAGE_TYPES.includes(contentType)
    const isVideo = ALLOWED_VIDEO_TYPES.includes(contentType)

    if (!isImage && !isVideo) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPG, PNG, GIF, WebP, MP4, WebM, MOV.' },
        { status: 400 },
      )
    }

    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE
    if (file.size > maxSize) {
      const maxMB = maxSize / (1024 * 1024)
      return NextResponse.json(
        { error: `File size exceeds ${maxMB}MB limit.` },
        { status: 400 },
      )
    }

    // Build the S3 key: folder/userId/uuid.ext
    const ext = EXT_MAP[contentType] || path.extname(file.name) || '.bin'
    const key = `${folder}/${user.id}/${randomUUID()}${ext}`

    // Read file into buffer and upload
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const url = await uploadToWasabi(key, buffer, contentType)

    return NextResponse.json({ url, key })
  } catch (error) {
    console.error('[media/upload] Error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
