import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', icon: '📸', color: '#E1306C', desc: 'Publica posts, reels y stories automáticamente' },
  { id: 'facebook', name: 'Facebook', icon: '👥', color: '#1877F2', desc: 'Gestiona tu página y publica contenido' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', color: '#ffffff', desc: 'Publica videos cortos con un click' },
  { id: 'google_ads', name: 'Google Ads', icon: '🔍', color: '#4285F4', desc: 'Gestiona tus campañas de búsqueda' },
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', color: '#0A66C2', desc: 'Contenido profesional B2B' },
]
export default async function PlatformsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: org } = await supabase.from('organizations').select('id').eq('owner_id', user.id).single()
  const { data: connections } = org ? await supabase.from('platform_connections').select('*').eq('org_id', org.id) : { data: [] }
  const connectedPlatforms = new Set(connections?.map(c => c.platform) ?? [])
  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/portal/settings" className="text-gray-400 hover:text-white transition-colors">← Configuración</Link>
          <h1 className="text-2xl font-bold text-white">Plataformas</h1>
        </div>
        <div className="space-y-4">
          {PLATFORMS.map(({ id, name, icon, color, desc }) => {
            const isConnected = connectedPlatforms.has(id)
            return (
              <div key={id} className="rounded-xl p-5 flex items-center justify-between" style={{ background: 'rgba(22,33,62,0.8)', border: `1px solid ${isConnected ? color + '40' : 'rgba(15,52,96,0.3)'}` }}>
                <div className="flex items-center gap-4">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <p className="text-white font-medium">{name}</p>
                    <p className="text-gray-400 text-sm">{desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isConnected ? (
                    <span className="flex items-center gap-1.5 text-sm text-green-400">
                      <span className="w-2 h-2 rounded-full bg-green-400" />
                      Conectado
                    </span>
                  ) : (
                    <button className="px-4 py-2 rounded-lg text-sm text-white transition-all hover:opacity-90" style={{ background: `${color}20`, border: `1px solid ${color}40`, color }}>
                      Conectar
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-6 p-4 rounded-xl" style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <p className="text-yellow-400 text-sm">⚡ Las integraciones OAuth con Meta, TikTok y Google estarán disponibles en la próxima actualización. Por ahora puedes generar y descargar contenido manualmente.</p>
        </div>
      </div>
    </div>
  )
}
