import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const { data: plans, error } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true })

    if (error) throw error

    return NextResponse.json({
      success: true,
      data: plans,
    })
  } catch (error: any) {
    console.error('Get plans error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch plans' },
      { status: 500 }
    )
  }
}
