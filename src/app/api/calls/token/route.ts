import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { NextResponse } from 'next/server'
import { AccessToken } from 'livekit-server-sdk'

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await req.json()
    if (!boardId || typeof boardId !== 'string') {
      return NextResponse.json({ error: 'boardId is required' }, { status: 400 })
    }

    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL

    if (!apiKey || !apiSecret || !livekitUrl) {
      console.error('[Calls] LiveKit environment variables not configured')
      return NextResponse.json({ error: 'Call service not configured' }, { status: 500 })
    }

    const user = session.user as any
    const roomName = `board_${boardId}`

    const token = new AccessToken(apiKey, apiSecret, {
      identity: user.id,
      name: user.name || 'User',
      metadata: JSON.stringify({ avatar: user.image || null }),
    })

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    })

    // 4-hour expiry for long collaboration sessions
    token.ttl = '4h'

    const jwt = await token.toJwt()

    return NextResponse.json({
      token: jwt,
      url: livekitUrl,
      room: roomName,
    })
  } catch (error) {
    console.error('[Calls] Token generation error:', error)
    return NextResponse.json({ error: 'Failed to generate call token' }, { status: 500 })
  }
}
