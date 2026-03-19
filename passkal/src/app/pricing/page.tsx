'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    price: '$297',
    period: '/mes',
    color: '#60a5fa',
    desc: 'Para negocios que están empezando',
    features: ['1 plataforma de publicación','8 piezas de contenido/mes','AI Business Advisor','Reporte mensual básico','Soporte por email'],
    popular: false,
  },
  {
    key: 'growth',
    name: 'Growth',
    price: '$697',
    period: '/mes',
    color: '#a78bfa',
    desc: 'Para negocios que quieren escalar',
    features: ['3 plataformas','20 piezas/mes','1 campaña de ads activa','A/B testing automático','Reporte mensual completo','AI Advisor avanzado'],
    popular: true,
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '$1,497',
    period: '/mes',
    color: '#34d399',
    desc: 'Para negocios serios',
    features: ['5 plataformas','40 piezas/mes','Campañas ilimitadas','Reporte PDF premium','AI Advisor premium','Ad spend management'],
    popular: false,
  },
  {
    key: 'agency',
    name: 'Agency',
    price: '$2,497',
    period: '/mes',
    color: '#fbbf24',
    desc: 'Para agencias y empresas',
    features: ['Todo ilimitado','White-label','API access','Manager dedicado','Onboarding personalizado','SLA 99.9%'],
    popular: false,
  },
]

export default function PricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  async function handleCheckout(plan: string) {
    setLoading(plan)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
      } else if (data.error === 'Unauthorized') {
        router.push('/register?redirect=/pricing')
      }
    } catch {
      alert('Error al procesar. Intenta de nuevo.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <main className="min-h-screen" style={{ background: 'linear-gradient(180deg, #0A0A1A 0%, #1A1A2E 100%)' }}>
      <nav className="fixed top-0 inset-x-0 z-50 border-b px-6 h-16 flex items-center justify-between" style={{ background: 'rgba(22,33,62,0.8)', borderColor: 'rgba(15,52,96,0.4)', backdropFilter: 'blur(12px)' }}>
        <Link href="/" className="text-xl font-bold" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
        <div className="flex gap-4">
          <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">Entrar</Link>
          <Link href="/register" className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: '#0F3460' }}>Crear cuenta</Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 pt-32 pb-20">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Planes que crecen contigo</h1>
          <p className="text-xl text-gray-400">Sin contratos. Sin sorpresas. Cancela cuando quieras.</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {PLANS.map((plan) => (
            <div key={plan.key} className="rounded-2xl p-6 flex flex-col relative" style={{ background: plan.popular ? 'rgba(83,52,131,0.15)' : 'rgba(22,33,62,0.8)', border: `1px solid ${plan.popular ? 'rgba(167,139,250,0.4)' : 'rgba(15,52,96,0.3)'}` }}>
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #533483, #0F3460)' }}>MÁS POPULAR</div>
              )}
              <div className="mb-4">
                <h3 className="text-white font-bold text-lg mb-1">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-3xl font-bold" style={{ color: plan.color }}>{plan.price}</span>
                  <span className="text-gray-400 text-sm">{plan.period}</span>
                </div>
                <p className="text-gray-400 text-sm">{plan.desc}</p>
              </div>
              <ul className="space-y-2 flex-1 mb-6">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                    <span style={{ color: plan.color }} className="shrink-0 mt-0.5">✓</span>{f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleCheckout(plan.key)}
                disabled={loading === plan.key}
                className="w-full py-3 rounded-xl text-center text-white font-medium text-sm transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: plan.popular ? 'linear-gradient(135deg, #533483, #0F3460)' : 'rgba(15,52,96,0.4)', border: `1px solid ${plan.color}40` }}>
                {loading === plan.key ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Redirigiendo...</>
                ) : 'Empezar ahora →'}
              </button>
            </div>
          ))}
        </div>

        {/* LLC Section */}
        <div className="rounded-2xl p-8 mb-12" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
          <h2 className="text-2xl font-bold text-white text-center mb-2">LLC Formation Service</h2>
          <p className="text-gray-400 text-center mb-8">Forma tu LLC en Nevada — rápido, legal y con AI</p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { key: 'llc_basic', name: 'LLC Básico', price: '$497', color: '#60a5fa', features: ['LLC Nevada', 'EIN federal', 'Registered Agent 1 año', 'Operating Agreement'], popular: false },
              { key: 'llc_brand', name: 'LLC + Branding', price: '$997', color: '#a78bfa', features: ['Todo básico', 'Logo profesional', 'Dominio .com', 'Email corporativo'], popular: true },
              { key: 'llc_full', name: 'LLC + Presencia', price: '$1,497', color: '#34d399', features: ['Todo branding', 'Website 5 páginas', 'SEO básico', 'Google Business'], popular: false },
            ].map(pkg => (
              <div key={pkg.key} className="rounded-xl p-5 flex flex-col relative" style={{ background: pkg.popular ? 'rgba(83,52,131,0.1)' : 'rgba(15,52,96,0.1)', border: `1px solid ${pkg.color}30` }}>
                {pkg.popular && <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: '#533483' }}>POPULAR</div>}
                <h3 className="text-white font-semibold mb-1">{pkg.name}</h3>
                <p className="text-2xl font-bold mb-3" style={{ color: pkg.color }}>{pkg.price}</p>
                <ul className="space-y-1 flex-1 mb-4">
                  {pkg.features.map(f => <li key={f} className="text-gray-400 text-sm flex items-center gap-2"><span style={{ color: pkg.color }}>✓</span>{f}</li>)}
                </ul>
                <button onClick={() => handleCheckout(pkg.key)} disabled={loading === pkg.key}
                  className="w-full py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: `${pkg.color}20`, border: `1px solid ${pkg.color}40`, color: pkg.color }}>
                  {loading === pkg.key ? <><span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />Cargando...</> : 'Contratar →'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Artist Section */}
        <div className="rounded-2xl p-8 mb-12" style={{ background: 'rgba(83,52,131,0.08)', border: '1px solid rgba(83,52,131,0.2)' }}>
          <h2 className="text-2xl font-bold text-white text-center mb-2">Artist Growth Engine</h2>
          <p className="text-gray-400 text-center mb-8">Crece en Spotify, YouTube e Instagram con AI</p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { key: 'artist_emerging', name: 'Emerging', price: '$97/mes', color: '#60a5fa', features: ['Hook Generator 5/mes', 'Playlist Pitcher 10/mes', 'YouTube SEO AI'], popular: false },
              { key: 'artist_growth', name: 'Growth', price: '$297/mes', color: '#a78bfa', features: ['Todo ilimitado', 'Release Planner', 'Analytics Analyzer', 'Collab Finder'], popular: true },
              { key: 'artist_label', name: 'Label', price: '$697/mes', color: '#34d399', features: ['Todo Growth x10 artistas', 'White-label', 'Manager dedicado'], popular: false },
            ].map(pkg => (
              <div key={pkg.key} className="rounded-xl p-5 flex flex-col relative" style={{ background: pkg.popular ? 'rgba(83,52,131,0.15)' : 'rgba(83,52,131,0.05)', border: `1px solid ${pkg.color}30` }}>
                {pkg.popular && <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: '#533483' }}>POPULAR</div>}
                <h3 className="text-white font-semibold mb-1">{pkg.name}</h3>
                <p className="text-xl font-bold mb-3" style={{ color: pkg.color }}>{pkg.price}</p>
                <ul className="space-y-1 flex-1 mb-4">
                  {pkg.features.map(f => <li key={f} className="text-gray-400 text-sm flex items-center gap-2"><span style={{ color: pkg.color }}>✓</span>{f}</li>)}
                </ul>
                <button onClick={() => handleCheckout(pkg.key)} disabled={loading === pkg.key}
                  className="w-full py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: `${pkg.color}20`, border: `1px solid ${pkg.color}40`, color: pkg.color }}>
                  {loading === pkg.key ? <><span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />Cargando...</> : 'Empezar →'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-8">Preguntas frecuentes</h2>
          <div className="space-y-4">
            {[
              { q: '¿Puedo cancelar cuando quiera?', a: 'Sí. Sin contratos ni penalidades. Cancela antes de tu próxima facturación.' },
              { q: '¿Qué método de pago aceptan?', a: 'Tarjetas de crédito y débito (Visa, Mastercard, Amex) via Stripe. 100% seguro.' },
              { q: '¿El contenido es generado por AI?', a: 'Claude AI genera el contenido basado en tu Brand DNA. Tú lo revisas antes de publicar.' },
              { q: '¿Cuándo se activa mi plan?', a: 'Inmediatamente después del pago. Recibirás un email de bienvenida con acceso.' },
            ].map(({ q, a }) => (
              <div key={q} className="rounded-xl p-5" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
                <p className="text-white font-medium mb-2">{q}</p>
                <p className="text-gray-400 text-sm">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
