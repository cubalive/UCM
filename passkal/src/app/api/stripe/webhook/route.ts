import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' as any })
}

export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  const stripe = getStripe()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Webhook signature failed' }, { status: 400 })
  }

  const supabase = createAdminClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.userId
    const plan = session.metadata?.plan
    if (!userId || !plan) return NextResponse.json({ received: true })

    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', userId)
      .single()

    if (org) {
      await supabase.from('organizations').update({
        plan: plan.replace('llc_', '').replace('artist_', ''),
        subscription_status: 'active',
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: (session.subscription as string) ?? null,
      }).eq('id', org.id)
    }

    if (process.env.RESEND_API_KEY) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name')
        .eq('id', userId)
        .single()

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `PASSKAL <team@passkal.com>`,
          to: [session.customer_email!],
          subject: `¡Bienvenido a PASSKAL ${plan.toUpperCase()}!`,
          html: `
<div style="font-family:sans-serif;background:#0A0A1A;color:#f9fafb;padding:20px;max-width:600px;margin:0 auto">
  <div style="background:#16213E;border:1px solid #0F3460;border-radius:12px;padding:32px;text-align:center">
    <h1 style="color:white;font-size:28px;margin-bottom:8px">¡Bienvenido a PASSKAL!</h1>
    <p style="color:#9ca3af;margin-bottom:24px">Hola ${profile?.full_name ?? 'amigo'}, tu plan está activo.</p>
    <div style="background:rgba(15,52,96,0.3);border-radius:10px;padding:16px;margin-bottom:24px">
      <p style="color:#60a5fa;font-weight:bold;font-size:18px;margin:0">Plan ${plan.toUpperCase()} activado</p>
    </div>
    <a href="${process.env.NEXT_PUBLIC_APP_URL}/portal/dashboard" style="display:inline-block;background:linear-gradient(135deg,#0F3460,#533483);color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600">
      Ir a mi portal
    </a>
    <p style="color:#6b7280;font-size:12px;margin-top:24px">¿Preguntas? Responde este email o usa el AI Advisor en tu portal.</p>
  </div>
</div>`,
        }),
      })
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription
    const customerId = sub.customer as string
    const status = sub.status

    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single()

    if (org) {
      await supabase.from('organizations').update({ subscription_status: status }).eq('id', org.id)
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const customerId = sub.customer as string

    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single()

    if (org) {
      await supabase.from('organizations').update({
        plan: 'free',
        subscription_status: 'cancelled',
      }).eq('id', org.id)
    }
  }

  return NextResponse.json({ received: true })
}
