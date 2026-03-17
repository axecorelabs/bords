import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.from('plans').select('id').limit(1)
    if (error) throw error
    return NextResponse.json({ 
      success: true, 
      message: 'Database connected successfully' 
    })
  } catch (error) {
    return NextResponse.json(
      { 
        success: false, 
        message: 'Database connection failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
