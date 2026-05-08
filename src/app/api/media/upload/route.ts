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

// Magic byte signatures for file validation
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/jpg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],  // GIF87a or GIF89a
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],  // RIFF (WebP container)
  'video/mp4': [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]],  // ftyp box
  'video/webm': [[0x1A, 0x45, 0xDF, 0xA3]],  // EBML
  'video/quicktime': [[0x00, 0x00, 0x00]],  // MOV/QuickTime (various atoms)
}

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
 * Validate file magic bytes against expected MIME type.
 * Returns true if the file header matches the declared MIME type.
 */
function validateMagicBytes(buffer: Buffer, contentType: string): boolean {
  const signatures = MAGIC_BYTES[contentType]
  if (!signatures) return false  // Unknown type, reject

  for (const sig of signatures) {
    if (buffer.length < sig.length) continue
    let matches = true
    for (let i = 0; i < sig.length; i++) {
      if (buffer[i] !== sig[i]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }

  return false
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
    const user = await getAuthUser(req)
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

    // Read file into buffer and validate magic bytes
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Verify file header matches declared MIME type
    if (!validateMagicBytes(buffer, contentType)) {
      return NextResponse.json(
        { error: 'File content does not match declared type. Possible file spoofing attempt.' },
        { status: 400 },
      )
    }

    // Build the S3 key: folder/userId/uuid.ext
    const ext = EXT_MAP[contentType] || path.extname(file.name) || '.bin'
    const key = `${folder}/${user.id}/${randomUUID()}${ext}`

    const url = await uploadToWasabi(key, buffer, contentType)

    return NextResponse.json({ url, key })
  } catch (error) {
    console.error('[media/upload] Error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
