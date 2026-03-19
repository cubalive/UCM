import Link from 'next/link'
const SERVICES = [
  { href: '/services/web-design', icon: '🌐', name: 'Diseño Web', price: 'Desde $1,997', desc: 'Sitios que convierten visitas en clientes. Mobile-first, SEO incluido.' },
  { href: '/services/seo', icon: '📈', name: 'SEO & Contenido', price: 'Desde $697/mes', desc: 'Posiciona tu negocio en Google con estrategia AI-powered.' },
  { href: '/services/promo-engine', icon: '🚀', name: 'Promo Engine', price: 'Desde $297/mes', desc: 'Marketing automation en Instagram, Facebook, TikTok y más.' },
  { href: '/services/apps-mvp', icon: '📱', name: 'Apps & MVPs', price: 'Desde $4,997', desc: 'Tu idea convertida en producto real en semanas, no meses.' },
  { href: '/services/automation-mms', icon: '💬', name: 'MMS Automation', price: 'Desde $497/mes', desc: 'Campañas de texto masivas con AI. 98% open rate.' },
  { href: '/services/qr-tools', icon: '📲', name: 'QR Tools', price: 'Desde $97/mes', desc: 'QR dinámicos con analytics en tiempo real.' },
]
export default function ServicesPage() {
  return (
    <main className="min-h-screen" style={{ background: 'linear-gradient(180deg, #0A0A1A 0%, #1A1A2E 100%)' }}>
      <nav className="fixed top-0 inset-x-0 z-50 border-b px-6 h-16 flex items-center justify-between" style={{ background: 'rgba(22,33,62,0.8)', borderColor: 'rgba(15,52,96,0.4)', backdropFilter: 'blur(12px)' }}>
        <Link href="/" className="text-xl font-bold" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
        <Link href="/register" className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: '#0F3460' }}>Empezar</Link>
      </nav>
      <div className="max-w-6xl mx-auto px-4 pt-32 pb-20">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Nuestros Servicios</h1>
          <p className="text-xl text-gray-400">Todo lo que necesitas para dominar el marketing digital</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SERVICES.map(({ href, icon, name, price, desc }) => (
            <Link key={href} href={href} className="rounded-2xl p-6 block transition-all hover:-translate-y-1 group" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="text-3xl mb-3">{icon}</div>
              <h3 className="text-white font-semibold text-lg mb-1 group-hover:text-blue-400 transition-colors">{name}</h3>
              <p className="text-blue-400 text-sm font-medium mb-3">{price}</p>
              <p className="text-gray-400 text-sm">{desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
