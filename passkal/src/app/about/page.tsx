import Link from 'next/link'
export default function AboutPage() {
  return (
    <main className="min-h-screen" style={{ background: 'linear-gradient(180deg, #0A0A1A 0%, #1A1A2E 100%)' }}>
      <nav className="fixed top-0 inset-x-0 z-50 border-b px-6 h-16 flex items-center justify-between" style={{ background: 'rgba(22,33,62,0.8)', borderColor: 'rgba(15,52,96,0.4)', backdropFilter: 'blur(12px)' }}>
        <Link href="/" className="text-xl font-bold" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
        <div className="flex gap-4">
          <Link href="/pricing" className="text-sm text-gray-400 hover:text-white transition-colors">Precios</Link>
          <Link href="/register" className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: '#0F3460' }}>Empezar</Link>
        </div>
      </nav>
      <div className="max-w-4xl mx-auto px-4 pt-32 pb-20">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium mb-6" style={{ background: 'rgba(15,52,96,0.3)', border: '1px solid rgba(15,52,96,0.5)', color: '#60a5fa' }}>
            🏢 PASSKAL LLC — Las Vegas, NV
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6">Somos la agencia que<br /><span style={{ background: 'linear-gradient(135deg, #0F3460, #533483, #0F6E56)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>trabaja mientras duermes</span></h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">Combinamos AI de última generación con estrategia de marketing real para hacer crecer negocios 3x más rápido.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {[
            { icon: '🤖', title: 'AI-Native desde día 1', desc: 'No usamos AI como herramienta — es el núcleo de todo lo que hacemos. Claude AI genera, analiza y optimiza sin parar.' },
            { icon: '⚡', title: '6 Motores Activos', desc: 'Lead Engine, Content Engine, Revenue Engine y más. Cada proceso repetible está automatizado.' },
            { icon: '📍', title: 'Las Vegas, NV', desc: 'Basados en el corazón de los negocios. Entendemos el mercado latino y anglosajón de EE.UU.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="rounded-2xl p-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="text-3xl mb-3">{icon}</div>
              <h3 className="text-white font-semibold mb-2">{title}</h3>
              <p className="text-gray-400 text-sm">{desc}</p>
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-8 mb-16" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
          <h2 className="text-2xl font-bold text-white mb-6 text-center">Nuestras plataformas</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { name: 'UCM — NEMT SaaS', desc: 'Medical transportation management', status: 'Live' },
              { name: 'PASSKAL.COM', desc: 'Esta plataforma — agencia AI-native', status: 'Live' },
              { name: 'NOCHE', desc: 'Nightlife & events Latino market', status: 'Building' },
              { name: '1GO2TRAVEL', desc: 'Travel intelligence platform', status: 'Building' },
              { name: 'JMorenoLive.com', desc: 'Artist & music platform', status: 'Building' },
            ].map(({ name, desc, status }) => (
              <div key={name} className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'rgba(15,52,96,0.1)', border: '1px solid rgba(15,52,96,0.2)' }}>
                <div>
                  <p className="text-white font-medium text-sm">{name}</p>
                  <p className="text-gray-400 text-xs">{desc}</p>
                </div>
                <span className="px-2 py-1 rounded-full text-xs font-medium" style={{ background: status === 'Live' ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)', color: status === 'Live' ? '#34d399' : '#fbbf24' }}>{status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="text-center">
          <h2 className="text-3xl font-bold text-white mb-4">¿Listo para trabajar con nosotros?</h2>
          <p className="text-gray-400 mb-8">Habla con nuestro AI ahora — responde en segundos</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/contact" className="px-8 py-4 rounded-xl text-white font-semibold transition-all hover:scale-105" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>Contactar →</Link>
            <Link href="/pricing" className="px-8 py-4 rounded-xl font-semibold transition-all hover:scale-105" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}>Ver precios</Link>
          </div>
        </div>
      </div>
    </main>
  )
}
