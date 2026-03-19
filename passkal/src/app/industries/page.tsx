import Link from 'next/link'
const INDUSTRIES = [
  { icon: '🍽️', name: 'Restaurantes y Food', desc: 'Aumenta reservas y pedidos online con contenido que apetece', services: ['Instagram/TikTok content', 'Google My Business', 'Campañas de delivery'] },
  { icon: '🏥', name: 'Clínicas y Salud', desc: 'Atrae más pacientes con marketing de confianza y autoridad', services: ['SEO médico', 'Google Ads', 'Email marketing'] },
  { icon: '🏠', name: 'Real Estate', desc: 'Genera leads de compradores y vendedores en piloto automático', services: ['Facebook/Instagram Ads', 'Landing pages', 'CRM automation'] },
  { icon: '💅', name: 'Belleza y Estética', desc: 'Llena tu agenda de citas con contenido visual irresistible', services: ['Reels y stories', 'Booking automation', 'Loyalty campaigns'] },
  { icon: '💪', name: 'Fitness y Bienestar', desc: 'Convierte seguidores en miembros con estrategia de contenido', services: ['Video content', 'Membership funnels', 'Community building'] },
  { icon: '⚖️', name: 'Firmas de Abogados', desc: 'Posiciónate como la autoridad legal en tu área', services: ['SEO legal', 'Google Ads', 'Reputation management'] },
  { icon: '🛍️', name: 'Ecommerce', desc: 'Escala tus ventas online con AI-powered marketing', services: ['Product ads', 'Email sequences', 'Retargeting'] },
  { icon: '🎵', name: 'Artistas y Música', desc: 'Haz crecer tu fanbase y monetiza tu arte', services: ['Social growth', 'Release campaigns', 'Merch promotion'] },
  { icon: '🚗', name: 'Automotriz', desc: 'Genera leads de compradores listos para cerrar', services: ['Facebook Ads', 'Inventory showcasing', 'Review management'] },
  { icon: '🏗️', name: 'Construcción', desc: 'Consigue más contratos con presencia digital profesional', services: ['Google Ads', 'Portfolio web', 'Lead generation'] },
  { icon: '🎪', name: 'Eventos', desc: 'Vende más tickets y llena tus eventos consistentemente', services: ['Event promotion', 'Ticket funnels', 'Post-event content'] },
  { icon: '🚀', name: 'Startups', desc: 'Crece rápido con marketing que escala contigo', services: ['Growth hacking', 'Product launches', 'Investor content'] },
]
export default function IndustriesPage() {
  return (
    <main className="min-h-screen" style={{ background: 'linear-gradient(180deg, #0A0A1A 0%, #1A1A2E 100%)' }}>
      <nav className="fixed top-0 inset-x-0 z-50 border-b px-6 h-16 flex items-center justify-between" style={{ background: 'rgba(22,33,62,0.8)', borderColor: 'rgba(15,52,96,0.4)', backdropFilter: 'blur(12px)' }}>
        <Link href="/" className="text-xl font-bold" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
        <Link href="/register" className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: '#0F3460' }}>Empezar</Link>
      </nav>
      <div className="max-w-6xl mx-auto px-4 pt-32 pb-20">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Servimos a todas las industrias</h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">Claude AI aprende tu industria y habla el idioma de tus clientes</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {INDUSTRIES.map(({ icon, name, desc, services }) => (
            <div key={name} className="rounded-2xl p-6 transition-all hover:-translate-y-1" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="text-3xl mb-3">{icon}</div>
              <h3 className="text-white font-semibold mb-2">{name}</h3>
              <p className="text-gray-400 text-sm mb-4">{desc}</p>
              <div className="flex flex-wrap gap-1">
                {services.map(s => (
                  <span key={s} className="px-2 py-0.5 rounded-full text-xs text-blue-300" style={{ background: 'rgba(15,52,96,0.3)', border: '1px solid rgba(15,52,96,0.4)' }}>{s}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-8 text-center" style={{ background: 'linear-gradient(135deg, rgba(15,52,96,0.4), rgba(83,52,131,0.4))', border: '1px solid rgba(15,52,96,0.5)' }}>
          <h2 className="text-3xl font-bold text-white mb-4">¿No ves tu industria?</h2>
          <p className="text-gray-400 mb-8">Trabajamos con cualquier negocio. Habla con nuestro AI y te diremos exactamente cómo podemos ayudarte.</p>
          <Link href="/contact" className="inline-block px-10 py-4 rounded-xl text-white font-semibold transition-all hover:scale-105" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Hablar con el AI →</Link>
        </div>
      </div>
    </main>
  )
}
