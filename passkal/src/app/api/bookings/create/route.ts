import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const body = await req.json()
  const supabase = createAdminClient()

  const { error } = await supabase.from('bookings').insert(body)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (process.env.RESEND_API_KEY && body.client_email) {
    try {
      const { data: page } = await supabase
        .from('booking_pages')
        .select('title, business_name')
        .eq('id', body.booking_page_id)
        .single()

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'PASSKAL Reservas <team@passkal.com>',
          to: [body.client_email],
          subject: `Reserva confirmada — ${page?.title ?? 'Tu cita'}`,
          html: `<div style="font-family:sans-serif;background:#0A0A1A;color:#f9fafb;padding:20px;max-width:500px;margin:0 auto">
            <div style="background:#16213E;border:1px solid #0F3460;border-radius:12px;padding:24px;text-align:center">
              <h1 style="color:white;margin-bottom:8px">Reserva confirmada!</h1>
              <p style="color:#9ca3af">Hola ${body.client_name}</p>
              <div style="background:rgba(15,52,96,0.3);border-radius:8px;padding:16px;margin:16px 0">
                <p style="color:#60a5fa;font-weight:bold;margin:0">${body.date} a las ${body.time_slot}</p>
                <p style="color:#d1d5db;font-size:14px;margin:4px 0">${page?.title ?? ''}</p>
              </div>
              <p style="color:#6b7280;font-size:12px">Te esperamos. Si necesitas cancelar contacta al negocio directamente.</p>
            </div>
          </div>`,
        }),
      })
    } catch (e) { console.error('Email error:', e) }
  }

  return NextResponse.json({ success: true })
}
