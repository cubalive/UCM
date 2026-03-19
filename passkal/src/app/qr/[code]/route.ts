import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const supabase = createAdminClient()
  const { data: qr } = await supabase.from('qr_codes').select('destination_url, is_active').eq('short_code', code).single()
  if (!qr || !qr.is_active) return NextResponse.redirect(new URL('/', request.url))
  await supabase.rpc('increment_qr_scan', { p_short_code: code })
  return NextResponse.redirect(qr.destination_url)
}
