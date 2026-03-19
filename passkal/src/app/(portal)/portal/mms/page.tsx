import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
export default async function MmsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: org } = await supabase.from('organizations').select('id, plan').eq('owner_id', user.id).single()
  const { data: campaigns } = org ? await supabase.from('mms_campaigns').select('*').eq('org_id', org.id).order('created_at', { ascending: false }) : { data: [] }
  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">MMS Campaigns</h1>
            <p className="text-gray-400 mt-1">Campañas de texto masivas con AI — 98% open rate</p>
          </div>
          <Link href="/portal/mms/create" className="px-6 py-3 rounded-xl text-white font-medium" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
            + Nueva campaña
          </Link>
        </div>
        {!campaigns || campaigns.length === 0 ? (
          <div className="rounded-2xl p-16 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px dashed rgba(15,52,96,0.4)' }}>
            <div className="text-5xl mb-4">💬</div>
            <h3 className="text-white font-semibold text-lg mb-2">No hay campañas todavía</h3>
            <p className="text-gray-400 mb-6">Crea tu primera campaña MMS con AI</p>
            <Link href="/portal/mms/create" className="px-8 py-3 rounded-xl text-white font-medium inline-block" style={{ background: '#0F3460' }}>Crear campaña →</Link>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <div className="divide-y" style={{ borderColor: 'rgba(15,52,96,0.2)' }}>
              {campaigns.map(c => {
                const statusColors: Record<string, string> = { draft: '#fbbf24', scheduled: '#60a5fa', sending: '#a78bfa', sent: '#34d399', failed: '#f87171', cancelled: '#9ca3af' }
                return (
                  <div key={c.id} className="px-6 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">{c.name}</p>
                      <p className="text-gray-400 text-sm mt-0.5">{c.recipient_count} destinatarios · {new Date(c.created_at).toLocaleDateString('es-US')}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-white text-sm font-medium">{c.delivered_count}</p>
                        <p className="text-gray-400 text-xs">entregados</p>
                      </div>
                      <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ background: `${statusColors[c.status] ?? '#60a5fa'}20`, color: statusColors[c.status] ?? '#60a5fa' }}>{c.status}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
