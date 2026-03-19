import Link from 'next/link'

const FEATURES = [
  { icon: '🤖', title: 'Estrategia AI-Powered', desc: 'Usamos inteligencia artificial para encontrar las keywords con mayor potencial de conversión.' },
  { icon: '📝', title: 'Contenido SEO', desc: 'Artículos optimizados escritos por expertos + AI que posicionan en las primeras páginas de Google.' },
  { icon: '🔗', title: 'Link Building', desc: 'Estrategia de backlinks de alta autoridad para mejorar tu Domain Authority.' },
  { icon: '📊', title: 'Auditoría Técnica', desc: 'Análisis completo de tu sitio: velocidad, estructura, errores y oportunidades de mejora.' },
  { icon: '📍', title: 'SEO Local', desc: 'Google My Business, citaciones locales y estrategia para dominar búsquedas en tu ciudad.' },
  { icon: '📈', title: 'Reportes Mensuales', desc: 'Dashboard con métricas claras: rankings, tráfico, conversiones y ROI de tu inversión.' },
]

const PLANS = [
  { name: 'Starter', price: '$697/mes', features: ['Hasta 10 keywords', '4 artículos SEO/mes', 'Auditoría técnica inicial', 'Google Search Console', 'Reporte mensual', 'Soporte por email'] },
  { name: 'Growth', price: '$1,497/mes', popular: true, features: ['Hasta 30 keywords', '8 artículos SEO/mes', 'Link building (5 backlinks/mes)', 'SEO local completo', 'Optimización de conversión', 'Dashboard en tiempo real', 'Soporte prioritario'] },
  { name: 'Enterprise', price: '$2,997/mes', features: ['Keywords ilimitadas', '16 artículos SEO/mes', 'Link building premium (15/mes)', 'SEO internacional', 'Estrategia de contenido completa', 'Account manager dedicado', 'Llamadas semanales'] },
]

const RESULTS = [
  { metric: '+340%', label: 'Tráfico orgánico promedio' },
  { metric: '#1-3', label: 'Posiciones en Google' },
  { metric: '4.2x', label: 'ROI promedio' },
  { metric: '90 días', label: 'Primeros resultados' },
]

export default function SeoPage() {
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
            <div className="text-5xl mb-4">📈</div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">SEO & Contenido</h1>
            <p className="text-xl text-gray-400 mb-6">Posiciona tu negocio en la primera página de Google con estrategia AI-powered y contenido que convierte.</p>
            <div className="flex items-baseline gap-2 mb-8">
              <span className="text-3xl font-bold text-blue-400">Desde $697/mes</span>
            </div>
            <div className="flex gap-4">
              <Link href="/register" className="px-6 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Auditoría SEO Gratis</Link>
              <Link href="/pricing" className="px-6 py-3 rounded-lg text-gray-300 font-medium border transition-colors hover:text-white" style={{ borderColor: 'rgba(15,52,96,0.5)' }}>Ver Planes</Link>
            </div>
          </div>
          <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <div className="text-8xl mb-4">🔍</div>
            <p className="text-gray-400">Domina los resultados de búsqueda</p>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {RESULTS.map(({ metric, label }) => (
            <div key={label} className="text-center rounded-2xl p-6" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="text-3xl font-bold text-blue-400 mb-1">{metric}</div>
              <div className="text-gray-400 text-sm">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">¿Qué Incluye?</h2>
        <p className="text-gray-400 text-center mb-12">Estrategia SEO completa para dominar tu nicho</p>
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
        <p className="text-gray-400 text-center mb-12">Inversión que se paga sola con resultados medibles</p>
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
          <h2 className="text-3xl font-bold text-white mb-4">¿Quieres más tráfico orgánico?</h2>
          <p className="text-gray-400 mb-8">Recibe una auditoría SEO gratuita de tu sitio web y descubre tu potencial de crecimiento.</p>
          <Link href="/register" className="inline-block px-8 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Auditoría SEO Gratis</Link>
        </div>
      </section>
    </main>
  )
}
