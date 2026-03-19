import Link from 'next/link'

const SERVICES = [
  { href: '/services/web-design', icon: '🌐', name: 'Diseño Web', desc: 'Sitios que convierten visitas en clientes' },
  { href: '/services/seo', icon: '📈', name: 'SEO & Contenido', desc: 'Domina Google con estrategia AI-powered' },
  { href: '/services/promo-engine', icon: '🚀', name: 'Promo Engine', desc: 'Marketing automation en redes sociales' },
  { href: '/services/apps-mvp', icon: '📱', name: 'Apps & MVPs', desc: 'Tu idea en producto real en semanas' },
  { href: '/services/automation-mms', icon: '💬', name: 'MMS Automation', desc: '98% open rate con campañas de texto' },
  { href: '/services/qr-tools', icon: '📲', name: 'QR Tools', desc: 'QR dinámicos con analytics en tiempo real' },
]

const STATS = [
  { value: '6+', label: 'Servicios AI' },
  { value: '150+', label: 'Clientes activos' },
  { value: '3x', label: 'Crecimiento promedio' },
  { value: '24/7', label: 'AI trabajando' },
]

const INDUSTRIES = [
  '🍽️ Restaurantes', '🏥 Clínicas', '🏠 Real Estate', '💅 Belleza',
  '💪 Fitness', '⚖️ Abogados', '🛍️ Ecommerce', '🎵 Artistas',
]

export default function HomePage() {
  return (
    <main className="min-h-screen" style={{ background: 'linear-gradient(180deg, #0A0A1A 0%, #1A1A2E 50%, #0A0A1A 100%)' }}>
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b px-6 h-16 flex items-center justify-between" style={{ background: 'rgba(22,33,62,0.8)', borderColor: 'rgba(15,52,96,0.4)', backdropFilter: 'blur(12px)' }}>
        <Link href="/" className="text-xl font-bold" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
        <div className="hidden md:flex items-center gap-6">
          <Link href="/services" className="text-sm text-gray-400 hover:text-white transition-colors">Servicios</Link>
          <Link href="/industries" className="text-sm text-gray-400 hover:text-white transition-colors">Industrias</Link>
          <Link href="/pricing" className="text-sm text-gray-400 hover:text-white transition-colors">Precios</Link>
          <Link href="/about" className="text-sm text-gray-400 hover:text-white transition-colors">Nosotros</Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">Entrar</Link>
          <Link href="/register" className="px-4 py-2 rounded-lg text-sm text-white font-medium" style={{ background: '#0F3460' }}>Empezar</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-32 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium mb-8" style={{ background: 'rgba(15,52,96,0.3)', border: '1px solid rgba(15,52,96,0.5)', color: '#60a5fa' }}>
          🤖 AI-Native Marketing Agency — Las Vegas, NV
        </div>
        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
          Marketing que<br />
          <span style={{ background: 'linear-gradient(135deg, #0F3460, #533483, #0F6E56)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>trabaja mientras duermes</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
          Combinamos inteligencia artificial con estrategia real para hacer crecer tu negocio 3x más rápido. Sin contratos, sin excusas.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
          <Link href="/register" className="px-8 py-4 rounded-xl text-white font-semibold text-lg transition-all hover:scale-105" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
            Empezar Gratis
          </Link>
          <Link href="/services" className="px-8 py-4 rounded-xl font-semibold text-lg transition-all hover:scale-105" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}>
            Ver Servicios
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
          {STATS.map(({ value, label }) => (
            <div key={label} className="text-center">
              <div className="text-3xl font-bold text-blue-400">{value}</div>
              <div className="text-gray-500 text-sm">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Services */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Nuestros Servicios</h2>
          <p className="text-gray-400 text-lg">Todo lo que necesitas para dominar el marketing digital</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SERVICES.map(({ href, icon, name, desc }) => (
            <Link key={href} href={href} className="rounded-2xl p-6 block transition-all hover:-translate-y-1 group" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="text-3xl mb-3">{icon}</div>
              <h3 className="text-white font-semibold text-lg mb-1 group-hover:text-blue-400 transition-colors">{name}</h3>
              <p className="text-gray-400 text-sm">{desc}</p>
            </Link>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link href="/services" className="text-blue-400 hover:underline text-sm">Ver todos los servicios &rarr;</Link>
        </div>
      </section>

      {/* Industries */}
      <section className="max-w-4xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Para Todas las Industrias</h2>
          <p className="text-gray-400">Nuestro AI aprende tu industria y habla el idioma de tus clientes</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          {INDUSTRIES.map(i => (
            <span key={i} className="px-4 py-2 rounded-full text-sm text-gray-300" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>{i}</span>
          ))}
        </div>
        <div className="text-center">
          <Link href="/industries" className="text-blue-400 hover:underline text-sm">Ver todas las industrias &rarr;</Link>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-4 py-20">
        <div className="rounded-2xl p-12 text-center" style={{ background: 'linear-gradient(135deg, rgba(15,52,96,0.6), rgba(83,52,131,0.4))', border: '1px solid rgba(15,52,96,0.3)' }}>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">¿Listo para crecer?</h2>
          <p className="text-gray-400 mb-8 text-lg">Agenda una llamada gratuita o crea tu cuenta para empezar hoy mismo.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register" className="px-8 py-4 rounded-xl text-white font-semibold transition-all hover:scale-105" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
              Crear Cuenta Gratis
            </Link>
            <Link href="/pricing" className="px-8 py-4 rounded-xl font-semibold transition-all hover:scale-105" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}>
              Ver Precios
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-12" style={{ borderColor: 'rgba(15,52,96,0.3)' }}>
        <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-8">
          <div>
            <div className="text-xl font-bold mb-3" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</div>
            <p className="text-gray-500 text-sm">AI-Powered Marketing Agency<br />Las Vegas, NV</p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3 text-sm">Servicios</h4>
            <div className="space-y-2">
              <Link href="/services/web-design" className="block text-gray-500 text-sm hover:text-gray-300">Diseño Web</Link>
              <Link href="/services/seo" className="block text-gray-500 text-sm hover:text-gray-300">SEO & Contenido</Link>
              <Link href="/services/promo-engine" className="block text-gray-500 text-sm hover:text-gray-300">Promo Engine</Link>
            </div>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3 text-sm">Más</h4>
            <div className="space-y-2">
              <Link href="/services/apps-mvp" className="block text-gray-500 text-sm hover:text-gray-300">Apps & MVPs</Link>
              <Link href="/services/automation-mms" className="block text-gray-500 text-sm hover:text-gray-300">MMS Automation</Link>
              <Link href="/services/qr-tools" className="block text-gray-500 text-sm hover:text-gray-300">QR Tools</Link>
            </div>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3 text-sm">Compañía</h4>
            <div className="space-y-2">
              <Link href="/about" className="block text-gray-500 text-sm hover:text-gray-300">Nosotros</Link>
              <Link href="/pricing" className="block text-gray-500 text-sm hover:text-gray-300">Precios</Link>
              <Link href="/industries" className="block text-gray-500 text-sm hover:text-gray-300">Industrias</Link>
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-8 pt-8 border-t text-center" style={{ borderColor: 'rgba(15,52,96,0.2)' }}>
          <p className="text-gray-600 text-sm">&copy; 2026 PASSKAL LLC. Todos los derechos reservados.</p>
        </div>
      </footer>
    </main>
  )
}
