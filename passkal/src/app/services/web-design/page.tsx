import Link from 'next/link'

const FEATURES = [
  { icon: '📱', title: 'Mobile-First', desc: 'Diseño responsivo que se ve perfecto en cualquier dispositivo. Google prioriza mobile.' },
  { icon: '⚡', title: 'Ultra Rápido', desc: 'Optimización de rendimiento para cargar en menos de 2 segundos. Core Web Vitals perfectos.' },
  { icon: '🔍', title: 'SEO Incluido', desc: 'Estructura optimizada para motores de búsqueda desde el día uno. Meta tags, schema markup y más.' },
  { icon: '🎨', title: 'Diseño Premium', desc: 'UI/UX profesional con tu identidad de marca. Sin templates genéricos.' },
  { icon: '🔒', title: 'SSL & Seguridad', desc: 'Certificado SSL, protección DDoS y backups automáticos incluidos.' },
  { icon: '📊', title: 'Analytics Integrado', desc: 'Google Analytics, heatmaps y tracking de conversiones configurado desde el lanzamiento.' },
]

const PROCESS = [
  { step: '01', title: 'Discovery', desc: 'Analizamos tu negocio, competencia y objetivos para definir la estrategia perfecta.' },
  { step: '02', title: 'Diseño', desc: 'Creamos wireframes y mockups de alta fidelidad para tu aprobación antes de programar.' },
  { step: '03', title: 'Desarrollo', desc: 'Programamos tu sitio con las últimas tecnologías: Next.js, React, Tailwind CSS.' },
  { step: '04', title: 'Lanzamiento', desc: 'Deploy en producción, configuración de dominio, SSL y monitoreo 24/7.' },
]

const PLANS = [
  { name: 'Landing Page', price: '$1,997', features: ['1 página optimizada', 'Formulario de contacto', 'SEO básico', 'Mobile responsive', 'SSL incluido', 'Entrega en 7 días'] },
  { name: 'Sitio Profesional', price: '$3,997', popular: true, features: ['Hasta 8 páginas', 'Blog integrado', 'SEO avanzado', 'CMS para editar contenido', 'Integración redes sociales', 'Analytics dashboard', 'Entrega en 14 días'] },
  { name: 'E-Commerce', price: '$6,997', features: ['Tienda completa', 'Pasarela de pagos', 'Inventario y envíos', 'SEO para productos', 'Panel de administración', 'Email marketing integrado', 'Entrega en 21 días'] },
]

export default function WebDesignPage() {
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
            <div className="text-5xl mb-4">🌐</div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Diseño Web</h1>
            <p className="text-xl text-gray-400 mb-6">Sitios que convierten visitas en clientes. Mobile-first, SEO incluido, rendimiento ultra rápido.</p>
            <div className="flex items-baseline gap-2 mb-8">
              <span className="text-3xl font-bold text-blue-400">Desde $1,997</span>
              <span className="text-gray-500">pago único</span>
            </div>
            <div className="flex gap-4">
              <Link href="/register" className="px-6 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Solicitar Cotización</Link>
              <Link href="/pricing" className="px-6 py-3 rounded-lg text-gray-300 font-medium border transition-colors hover:text-white" style={{ borderColor: 'rgba(15,52,96,0.5)' }}>Ver Planes</Link>
            </div>
          </div>
          <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <div className="text-8xl mb-4">💻</div>
            <p className="text-gray-400">Tu próximo sitio web profesional</p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">¿Qué Incluye?</h2>
        <p className="text-gray-400 text-center mb-12">Todo lo que necesitas para una presencia web profesional</p>
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

      {/* Process */}
      <section className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Nuestro Proceso</h2>
        <p className="text-gray-400 text-center mb-12">De la idea al lanzamiento en semanas, no meses</p>
        <div className="space-y-6">
          {PROCESS.map(({ step, title, desc }) => (
            <div key={step} className="flex gap-6 items-start rounded-2xl p-6" style={{ background: 'rgba(22,33,62,0.4)', border: '1px solid rgba(15,52,96,0.2)' }}>
              <div className="text-3xl font-bold text-blue-400/30 shrink-0">{step}</div>
              <div>
                <h3 className="text-white font-semibold text-lg mb-1">{title}</h3>
                <p className="text-gray-400 text-sm">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Planes & Precios</h2>
        <p className="text-gray-400 text-center mb-12">Elige el plan que mejor se adapte a tu negocio</p>
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
          <h2 className="text-3xl font-bold text-white mb-4">¿Listo para tu nuevo sitio web?</h2>
          <p className="text-gray-400 mb-8">Agenda una llamada gratuita y te mostraremos cómo podemos transformar tu presencia digital.</p>
          <Link href="/register" className="inline-block px-8 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Agendar Llamada Gratis</Link>
        </div>
      </section>
    </main>
  )
}
