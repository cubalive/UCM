import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' as any })
}

const PRICE_MAP: Record<string, string | undefined> = {
  starter:        process.env.STRIPE_PRICE_STARTER,
  growth:         process.env.STRIPE_PRICE_GROWTH,
  pro:            process.env.STRIPE_PRICE_PRO,
  agency:         process.env.STRIPE_PRICE_AGENCY,
  llc_basic:      process.env.STRIPE_PRICE_LLC_BASIC,
  llc_brand:      process.env.STRIPE_PRICE_LLC_BRAND,
  llc_full:       process.env.STRIPE_PRICE_LLC_FULL,
  artist_emerging:process.env.STRIPE_PRICE_ARTIST_EMERGING,
  artist_growth:  process.env.STRIPE_PRICE_ARTIST_GROWTH,
  artist_label:   process.env.STRIPE_PRICE_ARTIST_LABEL,
}

const ONE_TIME = new Set(['llc_basic','llc_brand','llc_full'])

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await req.json() as { plan: string }
  const priceId = PRICE_MAP[plan]
  if (!priceId) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://passkal.com'
  const isOneTime = ONE_TIME.has(plan)

  const session = await getStripe().checkout.sessions.create({
    customer_email: user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: isOneTime ? 'payment' : 'subscription',
    success_url: `${appUrl}/portal/billing?success=true&plan=${plan}`,
    cancel_url: `${appUrl}/pricing?cancelled=true`,
    metadata: { userId: user.id, plan },
    allow_promotion_codes: true,
  })

  return NextResponse.json({ url: session.url })
}
