import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('user_profiles').select('*').eq('id', user.id).single()
  const { data: org } = await supabase.from('organizations').select('*, brand_dna(*)').eq('owner_id', user.id).single()
  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/portal/dashboard" className="text-gray-400 hover:text-white transition-colors">← Dashboard</Link>
          <h1 className="text-2xl font-bold text-white">Configuración</h1>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl p-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <h2 className="text-white font-semibold mb-4">👤 Perfil</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-400 text-xs mb-1">Nombre</p>
                <p className="text-white">{profile?.full_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Email</p>
                <p className="text-white">{user.email}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Rol</p>
                <p className="text-white capitalize">{profile?.system_role ?? 'client'}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Miembro desde</p>
                <p className="text-white">{new Date(user.created_at).toLocaleDateString('es-US', { year: 'numeric', month: 'long' })}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <h2 className="text-white font-semibold mb-4">🏢 Organización</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-gray-400 text-xs mb-1">Nombre</p>
                <p className="text-white">{org?.name ?? '—'}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Plan</p>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium uppercase" style={{ background: org?.plan === 'free' ? 'rgba(156,163,175,0.1)' : 'rgba(52,211,153,0.1)', color: org?.plan === 'free' ? '#9ca3af' : '#34d399' }}>{org?.plan ?? 'free'}</span>
              </div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { href: '/portal/settings/brand', icon: '🧬', title: 'Brand DNA', desc: 'Configura el contexto AI de tu marca' },
              { href: '/portal/settings/platforms', icon: '🔗', title: 'Plataformas', desc: 'Conecta Instagram, Facebook, TikTok' },
              { href: '/portal/billing', icon: '💳', title: 'Facturación', desc: 'Gestiona tu plan y pagos' },
            ].map(({ href, icon, title, desc }) => (
              <Link key={href} href={href} className="rounded-xl p-5 flex items-center gap-4 transition-all hover:-translate-y-0.5 group" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
                <span className="text-2xl">{icon}</span>
                <div>
                  <p className="text-white font-medium group-hover:text-blue-400 transition-colors">{title}</p>
                  <p className="text-gray-400 text-sm">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
