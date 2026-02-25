import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

const WASABI_REGION     = process.env.WASABI_REGION || 'us-east-1'
const WASABI_BUCKET     = process.env.WASABI_BUCKET_NAME || ''
const WASABI_ENDPOINT   = process.env.WASABI_ENDPOINT || `https://s3.${WASABI_REGION}.wasabisys.com`
const WASABI_ACCESS_KEY = process.env.WASABI_ACCESS_KEY_ID || ''
const WASABI_SECRET_KEY = process.env.WASABI_SECRET_ACCESS_KEY || ''

export const s3Client = new S3Client({
  region: WASABI_REGION,
  endpoint: WASABI_ENDPOINT,
  credentials: {
    accessKeyId: WASABI_ACCESS_KEY,
    secretAccessKey: WASABI_SECRET_KEY,
  },
  forcePathStyle: true, // Required for Wasabi
})

/**
 * Build the public URL for an object in the bucket.
 */
export function getPublicUrl(key: string): string {
  return `${WASABI_ENDPOINT}/${WASABI_BUCKET}/${key}`
}

/**
 * Upload a file buffer to Wasabi.
 * @returns The public URL of the uploaded file.
 */
export async function uploadToWasabi(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: WASABI_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: 'public-read',
    }),
  )
  return getPublicUrl(key)
}

/**
 * Delete an object from Wasabi.
 */
export async function deleteFromWasabi(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: WASABI_BUCKET,
      Key: key,
    }),
  )
}

/**
 * Extract the S3 key from a full Wasabi URL.
 * e.g. "https://s3.us-east-1.wasabisys.com/bucket/media/uid/abc.jpg" → "media/uid/abc.jpg"
 */
export function extractKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    // Path-style: /bucket/key
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    // Remove the bucket name (first segment)
    return parts.slice(1).join('/')
  } catch {
    return null
  }
}
