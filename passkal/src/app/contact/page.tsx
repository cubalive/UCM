import Link from 'next/link'

export default function ContactPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(180deg, #0A0A1A 0%, #1A1A2E 100%)' }}>
      <div className="max-w-lg w-full text-center">
        <Link href="/" className="text-2xl font-bold inline-block mb-8" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
        <div className="rounded-2xl p-8" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
          <div className="text-5xl mb-4">📧</div>
          <h1 className="text-3xl font-bold text-white mb-4">Contáctanos</h1>
          <p className="text-gray-400 mb-6">Estamos listos para ayudarte a crecer tu negocio.</p>
          <div className="space-y-4">
            <a href="mailto:team@passkal.com" className="block px-6 py-3 rounded-lg text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
              team@passkal.com
            </a>
            <p className="text-gray-500 text-sm">Respondemos en menos de 24 horas</p>
          </div>
        </div>
        <Link href="/" className="text-gray-500 text-sm hover:text-gray-300 mt-6 inline-block">&larr; Volver al inicio</Link>
      </div>
    </main>
  )
}
