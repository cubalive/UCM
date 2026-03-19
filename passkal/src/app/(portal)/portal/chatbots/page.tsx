import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ChatbotsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Customer Support Bot</h1>
            <p className="text-gray-400 mt-1">Crea un chatbot AI para tu negocio en minutos</p>
          </div>
          <Link href="/portal/chatbots/create" className="px-6 py-3 rounded-xl text-white font-medium" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
            + Crear chatbot
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {[
            { icon: '⚡', title: 'Listo en 5 minutos', desc: 'Solo describe tu negocio y Claude aprende todo sobre el' },
            { icon: '💬', title: 'Responde 24/7', desc: 'Tu chatbot atiende clientes mientras duermes' },
            { icon: '🔌', title: 'Instala en cualquier web', desc: 'Un snippet de codigo y listo. Compatible con cualquier website' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="rounded-xl p-5" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="text-3xl mb-3">{icon}</div>
              <h3 className="text-white font-semibold mb-2">{title}</h3>
              <p className="text-gray-400 text-sm">{desc}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-12 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px dashed rgba(15,52,96,0.4)' }}>
          <div className="text-5xl mb-4">🤖</div>
          <h3 className="text-white font-semibold text-lg mb-2">No tienes chatbots todavia</h3>
          <p className="text-gray-400 mb-6">Crea tu primer chatbot de atencion al cliente</p>
          <Link href="/portal/chatbots/create" className="px-8 py-3 rounded-xl text-white font-medium inline-block" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
            Crear mi chatbot
          </Link>
        </div>
      </div>
    </div>
  )
}
