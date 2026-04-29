import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { cacheGet, cacheSet, CacheKeys, CacheTTL } from '@/lib/cache'

export async function GET() {
  try {
    // Check cache first
    const cached = await cacheGet<{ success: boolean; data: unknown[] }>(CacheKeys.plans())
    if (cached) return NextResponse.json(cached)

    const { data: plans, error } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true })

    if (error) throw error

    const body = { success: true, data: plans }
    await cacheSet(CacheKeys.plans(), body, CacheTTL.PLANS)

    return NextResponse.json(body)
  } catch (error: any) {
    console.error('Get plans error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch plans' },
      { status: 500 }
    )
  }
}
