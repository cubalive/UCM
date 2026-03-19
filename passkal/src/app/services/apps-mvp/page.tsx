import Link from 'next/link'

const FEATURES = [
  { icon: '🎯', title: 'Product Discovery', desc: 'Validamos tu idea con research de mercado antes de escribir una sola línea de código.' },
  { icon: '🎨', title: 'UI/UX Design', desc: 'Prototipos interactivos de alta fidelidad. Iteramos hasta que estés 100% satisfecho.' },
  { icon: '⚡', title: 'Desarrollo Ágil', desc: 'Sprints de 2 semanas con demos. Ves progreso real desde la primera semana.' },
  { icon: '☁️', title: 'Cloud Native', desc: 'Arquitectura escalable en AWS/Vercel. Tu app lista para miles de usuarios desde el día uno.' },
  { icon: '📱', title: 'Cross-Platform', desc: 'Apps web + iOS + Android con una sola base de código. React Native o Flutter.' },
  { icon: '🚀', title: 'Launch Support', desc: 'Te ayudamos con el lanzamiento: App Store, Google Play, marketing y analytics.' },
]

const TECH = [
  'React / Next.js', 'React Native', 'Flutter', 'Node.js', 'PostgreSQL', 'Supabase',
  'AWS', 'Vercel', 'Stripe', 'Firebase', 'TypeScript', 'Tailwind CSS',
]

const PLANS = [
  { name: 'MVP Lite', price: '$4,997', features: ['App web responsive', 'Hasta 5 pantallas', 'Auth + base de datos', 'Hosting incluido (3 meses)', 'Entrega en 3 semanas', '1 ronda de revisiones'] },
  { name: 'MVP Pro', price: '$9,997', popular: true, features: ['App web + mobile (iOS/Android)', 'Hasta 15 pantallas', 'API + integraciones', 'Dashboard admin', 'Hosting incluido (6 meses)', 'Entrega en 6 semanas', '3 rondas de revisiones'] },
  { name: 'Product Build', price: '$19,997+', features: ['Producto completo', 'Pantallas ilimitadas', 'Arquitectura enterprise', 'Integraciones complejas', 'QA testing completo', 'Hosting incluido (12 meses)', 'Soporte continuo 3 meses'] },
]

export default function AppsMvpPage() {
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
            <div className="text-5xl mb-4">📱</div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Apps & MVPs</h1>
            <p className="text-xl text-gray-400 mb-6">Tu idea convertida en producto real en semanas, no meses. Desarrollo ágil con tecnología de punta.</p>
            <div className="flex items-baseline gap-2 mb-8">
              <span className="text-3xl font-bold text-blue-400">Desde $4,997</span>
              <span className="text-gray-500">pago único</span>
            </div>
            <div className="flex gap-4">
              <Link href="/register" className="px-6 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Agendar Consulta</Link>
              <Link href="/pricing" className="px-6 py-3 rounded-lg text-gray-300 font-medium border transition-colors hover:text-white" style={{ borderColor: 'rgba(15,52,96,0.5)' }}>Ver Planes</Link>
            </div>
          </div>
          <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <div className="text-8xl mb-4">🛠️</div>
            <p className="text-gray-400">De la idea al producto en semanas</p>
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="max-w-4xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold text-white mb-8 text-center">Tecnologías que Usamos</h2>
        <div className="flex flex-wrap justify-center gap-3">
          {TECH.map(t => (
            <span key={t} className="px-4 py-2 rounded-full text-sm text-gray-300" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.4)' }}>{t}</span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Nuestro Proceso</h2>
        <p className="text-gray-400 text-center mb-12">Desarrollo ágil con entregas semanales y comunicación constante</p>
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
        <p className="text-gray-400 text-center mb-12">Desde MVP rápido hasta producto enterprise completo</p>
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
          <h2 className="text-3xl font-bold text-white mb-4">¿Tienes una idea de app?</h2>
          <p className="text-gray-400 mb-8">Agenda una consulta gratuita. Te damos un roadmap y estimado sin compromiso.</p>
          <Link href="/register" className="inline-block px-8 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Consulta Gratuita</Link>
        </div>
      </section>
    </main>
  )
}
