'use client'

import Link from 'next/link'

const TOOLS = [
  { href: '/portal/consulting/mvp-planner', icon: '🚀', title: 'MVP Roadmap Generator', desc: 'Describe tu idea y Claude genera roadmap completo, fases, tech stack y costos', badge: 'POPULAR', color: '#60a5fa' },
  { href: '/portal/consulting/business-model', icon: '📊', title: 'Business Model Canvas', desc: 'Genera tu modelo de negocio completo con 9 bloques en minutos', badge: '', color: '#34d399' },
  { href: '/portal/consulting/market-validation', icon: '🔍', title: 'Market Validation AI', desc: 'Analiza viabilidad, competencia y mercado de tu idea con web search', badge: 'AI+WEB', color: '#a78bfa' },
  { href: '/portal/consulting/monetization', icon: '💰', title: 'Monetization Strategy', desc: '3 modelos de monetizacion con proyecciones financieras para tu negocio', badge: '', color: '#fbbf24' },
  { href: '/portal/consulting/tech-specs', icon: '⚙️', title: 'Technical Requirements', desc: 'Documento tecnico completo para desarrolladores basado en tu idea', badge: '', color: '#fb923c' },
  { href: '/portal/consulting/pitch-deck', icon: '📑', title: 'Pitch Deck Outline', desc: 'Estructura completa de 10 slides para tu pitch a inversores', badge: 'NUEVO', color: '#f472b6' },
]

export default function ConsultingPage() {
  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Product Consulting Suite</h1>
          <p className="text-gray-400 mt-1">Convierte tu idea en un plan de negocio real con Claude AI</p>
        </div>

        <div className="rounded-2xl p-6 mb-8" style={{ background: 'linear-gradient(135deg, rgba(15,52,96,0.3), rgba(83,52,131,0.3))', border: '1px solid rgba(83,52,131,0.3)' }}>
          <p className="text-white font-semibold mb-1">Tienes una idea pero no sabes por donde empezar?</p>
          <p className="text-gray-400 text-sm">Estas herramientas te dan claridad en minutos. Desde el roadmap hasta el pitch a inversores.</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {TOOLS.map(({ href, icon, title, desc, badge, color }) => (
            <Link key={href} href={href}
              className="rounded-2xl p-6 flex flex-col transition-all hover:-translate-y-1 group"
              style={{ background: 'rgba(22,33,62,0.8)', border: `1px solid ${color}20` }}>
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">{icon}</span>
                {badge && <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>{badge}</span>}
              </div>
              <h3 className="text-white font-semibold mb-2 group-hover:text-blue-400 transition-colors">{title}</h3>
              <p className="text-gray-400 text-sm flex-1">{desc}</p>
              <div className="mt-4 text-xs font-medium flex items-center gap-1" style={{ color }}>
                Abrir herramienta
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
