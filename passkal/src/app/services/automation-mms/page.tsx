import Link from 'next/link'

const FEATURES = [
  { icon: '💬', title: 'SMS & MMS Masivo', desc: 'Envía miles de mensajes de texto con imágenes, GIFs y videos a tu base de contactos.' },
  { icon: '🤖', title: 'AI Copywriting', desc: 'Genera mensajes personalizados con inteligencia artificial que maximizan el open rate.' },
  { icon: '🎯', title: 'Segmentación Smart', desc: 'Divide tu audiencia por comportamiento, ubicación, historial de compras y más.' },
  { icon: '📊', title: 'Analytics en Tiempo Real', desc: 'Tracking de entregas, aperturas, clicks y conversiones al instante.' },
  { icon: '🔄', title: 'Automaciones', desc: 'Triggers automáticos: bienvenida, carrito abandonado, cumpleaños, re-engagement.' },
  { icon: '📋', title: 'Compliance', desc: 'Gestión automática de opt-in/opt-out. Cumplimiento total con regulaciones TCPA.' },
]

const STATS = [
  { metric: '98%', label: 'Open rate promedio' },
  { metric: '45%', label: 'Click-through rate' },
  { metric: '10x', label: 'ROI vs email marketing' },
  { metric: '<3min', label: 'Tiempo de lectura' },
]

const PLANS = [
  { name: 'Starter', price: '$497/mes', features: ['5,000 mensajes/mes', 'SMS + MMS', 'AI copywriting', '1 automatización', 'Analytics básico', 'Soporte por email'] },
  { name: 'Growth', price: '$997/mes', popular: true, features: ['25,000 mensajes/mes', 'SMS + MMS + RCS', 'AI copywriting avanzado', 'Automatizaciones ilimitadas', 'Segmentación avanzada', 'A/B testing', 'API access', 'Soporte prioritario'] },
  { name: 'Enterprise', price: '$2,497/mes', features: ['100,000+ mensajes/mes', 'Todos los canales', 'Dedicated short code', 'Custom integrations', 'Account manager dedicado', 'SLA garantizado', 'Llamadas semanales'] },
]

export default function AutomationMmsPage() {
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
            <div className="text-5xl mb-4">💬</div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">MMS Automation</h1>
            <p className="text-xl text-gray-400 mb-6">Campañas de texto masivas con AI. 98% open rate. El canal de marketing más efectivo que existe.</p>
            <div className="flex items-baseline gap-2 mb-8">
              <span className="text-3xl font-bold text-blue-400">Desde $497/mes</span>
            </div>
            <div className="flex gap-4">
              <Link href="/register" className="px-6 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Empezar Ahora</Link>
              <Link href="/pricing" className="px-6 py-3 rounded-lg text-gray-300 font-medium border transition-colors hover:text-white" style={{ borderColor: 'rgba(15,52,96,0.5)' }}>Ver Planes</Link>
            </div>
          </div>
          <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <div className="text-8xl mb-4">📲</div>
            <p className="text-gray-400">Llega directo al bolsillo de tus clientes</p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {STATS.map(({ metric, label }) => (
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
        <p className="text-gray-400 text-center mb-12">Todo lo que necesitas para campañas SMS/MMS exitosas</p>
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
        <p className="text-gray-400 text-center mb-12">Escala tus campañas de texto con el plan perfecto</p>
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
          <h2 className="text-3xl font-bold text-white mb-4">¿Listo para el 98% open rate?</h2>
          <p className="text-gray-400 mb-8">Empieza con una prueba gratuita y envía tus primeros 500 mensajes sin costo.</p>
          <Link href="/register" className="inline-block px-8 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>500 Mensajes Gratis</Link>
        </div>
      </section>
    </main>
  )
}
