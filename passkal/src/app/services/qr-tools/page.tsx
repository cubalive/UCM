import Link from 'next/link'

const FEATURES = [
  { icon: '🔄', title: 'QR Dinámicos', desc: 'Cambia el destino del QR sin reimprimir. Actualiza URLs, menús, promociones en tiempo real.' },
  { icon: '📊', title: 'Analytics Avanzado', desc: 'Tracking de scans: ubicación, dispositivo, hora, frecuencia. Todo en un dashboard visual.' },
  { icon: '🎨', title: 'Diseño Personalizado', desc: 'QR con tu logo, colores de marca y diseños únicos que se integran con tu identidad visual.' },
  { icon: '📍', title: 'Geo-Tracking', desc: 'Mapa de calor con la ubicación de cada scan. Ideal para campañas offline.' },
  { icon: '🔗', title: 'Smart Links', desc: 'Redirección inteligente según dispositivo, ubicación o hora del día.' },
  { icon: '📱', title: 'Landing Pages', desc: 'Micro-landing pages optimizadas para mobile incluidas con cada QR.' },
]

const USE_CASES = [
  { icon: '🍽️', title: 'Restaurantes', desc: 'Menús digitales que se actualizan al instante' },
  { icon: '🏪', title: 'Retail', desc: 'Promociones en tienda con tracking de conversión' },
  { icon: '🏨', title: 'Hoteles', desc: 'Check-in, room service y guías digitales' },
  { icon: '📦', title: 'Productos', desc: 'Información de producto, garantías y soporte' },
  { icon: '🎫', title: 'Eventos', desc: 'Tickets, check-in y experiencias interactivas' },
  { icon: '💼', title: 'Tarjetas', desc: 'Business cards digitales con vCard' },
]

const PLANS = [
  { name: 'Free', price: '$0', features: ['5 QR estáticos', 'Scans ilimitados', 'Formatos PNG/SVG', 'Analytics básico'] },
  { name: 'Pro', price: '$97/mes', popular: true, features: ['QR dinámicos ilimitados', 'Analytics avanzado', 'Diseño personalizado', 'Geo-tracking', 'Smart links', 'Landing pages', 'API access', 'Soporte prioritario'] },
  { name: 'Business', price: '$247/mes', features: ['Todo de Pro', 'White-label', 'Bulk generation', 'Custom domain', 'Team management', 'SSO / SAML', 'Account manager', 'SLA garantizado'] },
]

export default function QrToolsPage() {
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
            <div className="text-5xl mb-4">📲</div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">QR Tools</h1>
            <p className="text-xl text-gray-400 mb-6">QR dinámicos con analytics en tiempo real. Conecta el mundo físico con el digital.</p>
            <div className="flex items-baseline gap-2 mb-8">
              <span className="text-3xl font-bold text-blue-400">Desde $97/mes</span>
            </div>
            <div className="flex gap-4">
              <Link href="/register" className="px-6 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Crear QR Gratis</Link>
              <Link href="/pricing" className="px-6 py-3 rounded-lg text-gray-300 font-medium border transition-colors hover:text-white" style={{ borderColor: 'rgba(15,52,96,0.5)' }}>Ver Planes</Link>
            </div>
          </div>
          <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <div className="text-8xl mb-4">📱</div>
            <p className="text-gray-400">QR inteligentes para tu negocio</p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Funcionalidades</h2>
        <p className="text-gray-400 text-center mb-12">Más que un simple código QR</p>
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

      {/* Use Cases */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Casos de Uso</h2>
        <p className="text-gray-400 text-center mb-12">QR Tools se adapta a cualquier industria</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {USE_CASES.map(({ icon, title, desc }) => (
            <div key={title} className="rounded-xl p-5 text-center" style={{ background: 'rgba(22,33,62,0.4)', border: '1px solid rgba(15,52,96,0.2)' }}>
              <div className="text-3xl mb-2">{icon}</div>
              <h3 className="text-white font-semibold text-sm mb-1">{title}</h3>
              <p className="text-gray-500 text-xs">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Planes & Precios</h2>
        <p className="text-gray-400 text-center mb-12">Empieza gratis, escala cuando necesites</p>
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
              <Link href="/register" className="block text-center px-4 py-2 rounded-lg text-white text-sm font-medium transition-all hover:opacity-90" style={{ background: popular ? 'linear-gradient(135deg, #0F3460, #533483)' : '#0F3460' }}>{name === 'Free' ? 'Crear QR Gratis' : 'Empezar Ahora'}</Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="rounded-2xl p-12" style={{ background: 'linear-gradient(135deg, rgba(15,52,96,0.6), rgba(83,52,131,0.4))', border: '1px solid rgba(15,52,96,0.3)' }}>
          <h2 className="text-3xl font-bold text-white mb-4">Crea tu primer QR en segundos</h2>
          <p className="text-gray-400 mb-8">Genera QR dinámicos gratis. Sin tarjeta de crédito requerida.</p>
          <Link href="/register" className="inline-block px-8 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Empezar Gratis</Link>
        </div>
      </section>
    </main>
  )
}
