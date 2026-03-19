import Link from 'next/link'

const FEATURES = [
  { icon: '📅', title: 'Calendario de Contenido', desc: 'Planificación mensual automatizada con AI para Instagram, Facebook, TikTok y LinkedIn.' },
  { icon: '🎯', title: 'Segmentación Avanzada', desc: 'Audiencias personalizadas basadas en comportamiento, intereses y datos demográficos.' },
  { icon: '🤖', title: 'AI Content Generator', desc: 'Genera captions, hashtags y creativos optimizados para cada plataforma automáticamente.' },
  { icon: '📊', title: 'Analytics Unificado', desc: 'Dashboard centralizado con métricas de todas tus redes sociales en un solo lugar.' },
  { icon: '🔄', title: 'Auto-Posting', desc: 'Programación y publicación automática en el horario óptimo para tu audiencia.' },
  { icon: '💰', title: 'Ad Management', desc: 'Gestión de campañas de publicidad pagada con optimización automática del presupuesto.' },
]

const PLATFORMS = [
  { name: 'Instagram', icon: '📸' },
  { name: 'Facebook', icon: '👥' },
  { name: 'TikTok', icon: '🎵' },
  { name: 'LinkedIn', icon: '💼' },
  { name: 'X (Twitter)', icon: '🐦' },
  { name: 'YouTube', icon: '▶️' },
]

const PLANS = [
  { name: 'Starter', price: '$297/mes', features: ['2 plataformas', '12 posts/mes', 'AI captions', 'Auto-posting', 'Analytics básico', 'Soporte por email'] },
  { name: 'Pro', price: '$697/mes', popular: true, features: ['4 plataformas', '30 posts/mes', 'AI content + creativos', 'Stories y Reels', 'Ad management básico', 'Analytics avanzado', 'Community management'] },
  { name: 'Agency', price: '$1,497/mes', features: ['Todas las plataformas', 'Posts ilimitados', 'Video content incluido', 'Influencer outreach', 'Ad management premium', 'Account manager dedicado', 'Estrategia personalizada'] },
]

export default function PromoEnginePage() {
  return (
    <main className="min-h-screen" style={{ background: 'linear-gradient(180deg, #0A0A1A 0%, #1A1A2E 100%)' }}>
      <nav className="fixed top-0 inset-x-0 z-50 border-b px-6 h-16 flex items-center justify-between" style={{ background: 'rgba(22,33,62,0.8)', borderColor: 'rgba(15,52,96,0.4)', backdropFilter: 'blur(12px)' }}>
        <Link href="/" className="text-xl font-bold" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
        <div className="flex items-center gap-4">
          <Link href="/services" className="text-gray-400 hover:text-white text-sm transition-colors">Servicios</Link>
          <Link href="/register" className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: '#0F3460' }}>Empezar</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-32 pb-16">
        <Link href="/services" className="text-blue-400 text-sm hover:underline mb-4 inline-block">&larr; Todos los servicios</Link>
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="text-5xl mb-4">🚀</div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Promo Engine</h1>
            <p className="text-xl text-gray-400 mb-6">Marketing automation en Instagram, Facebook, TikTok y más. Contenido AI-powered que genera engagement real.</p>
            <div className="flex items-baseline gap-2 mb-8">
              <span className="text-3xl font-bold text-blue-400">Desde $297/mes</span>
            </div>
            <div className="flex gap-4">
              <Link href="/register" className="px-6 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Empezar Ahora</Link>
              <Link href="/pricing" className="px-6 py-3 rounded-lg text-gray-300 font-medium border transition-colors hover:text-white" style={{ borderColor: 'rgba(15,52,96,0.5)' }}>Ver Planes</Link>
            </div>
          </div>
          <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <div className="text-8xl mb-4">📱</div>
            <p className="text-gray-400">Automatiza tu marketing digital</p>
          </div>
        </div>
      </section>

      {/* Platforms */}
      <section className="max-w-4xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold text-white mb-8 text-center">Plataformas Soportadas</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
          {PLATFORMS.map(({ name, icon }) => (
            <div key={name} className="text-center rounded-xl p-4" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="text-3xl mb-2">{icon}</div>
              <div className="text-gray-400 text-xs">{name}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">¿Qué Incluye?</h2>
        <p className="text-gray-400 text-center mb-12">Todo lo que necesitas para dominar las redes sociales</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(({ icon, title, desc }) => (
            <div key={title} className="rounded-2xl p-6" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="text-3xl mb-3">{icon}</div>
              <h3 className="text-white font-semibold text-lg mb-2">{title}</h3>
              <p className="text-gray-400 text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Planes & Precios</h2>
        <p className="text-gray-400 text-center mb-12">Escala tu presencia en redes sin escalar tu equipo</p>
        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.map(({ name, price, popular, features }) => (
            <div key={name} className="rounded-2xl p-6 relative" style={{ background: popular ? 'rgba(15,52,96,0.4)' : 'rgba(22,33,62,0.6)', border: popular ? '2px solid #0F3460' : '1px solid rgba(15,52,96,0.3)' }}>
              {popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">POPULAR</div>}
              <h3 className="text-white font-semibold text-lg mb-1">{name}</h3>
              <div className="text-3xl font-bold text-blue-400 mb-4">{price}</div>
              <ul className="space-y-2 mb-6">
                {features.map(f => (
                  <li key={f} className="text-gray-400 text-sm flex items-center gap-2">
                    <span className="text-green-400">&#10003;</span> {f}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="block text-center px-4 py-2 rounded-lg text-white text-sm font-medium transition-all hover:opacity-90" style={{ background: popular ? 'linear-gradient(135deg, #0F3460, #533483)' : '#0F3460' }}>Empezar Ahora</Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="rounded-2xl p-12" style={{ background: 'linear-gradient(135deg, rgba(15,52,96,0.6), rgba(83,52,131,0.4))', border: '1px solid rgba(15,52,96,0.3)' }}>
          <h2 className="text-3xl font-bold text-white mb-4">¿Listo para automatizar tu marketing?</h2>
          <p className="text-gray-400 mb-8">Prueba Promo Engine gratis por 7 días y ve los resultados por ti mismo.</p>
          <Link href="/register" className="inline-block px-8 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Prueba Gratis 7 Días</Link>
        </div>
      </section>
    </main>
  )
}
