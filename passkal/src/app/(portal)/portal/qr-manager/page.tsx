import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
export default async function QrManagerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: org } = await supabase.from('organizations').select('id').eq('owner_id', user.id).single()
  const { data: qrCodes } = org ? await supabase.from('qr_codes').select('*').eq('org_id', org.id).order('created_at', { ascending: false }) : { data: [] }
  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">QR Manager</h1>
            <p className="text-gray-400 mt-1">Crea QR codes dinámicos con analytics en tiempo real</p>
          </div>
          <Link href="/portal/qr-manager/create" className="px-6 py-3 rounded-xl text-white font-medium transition-all hover:opacity-90 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
            + Nuevo QR
          </Link>
        </div>
        {!qrCodes || qrCodes.length === 0 ? (
          <div className="rounded-2xl p-16 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px dashed rgba(15,52,96,0.4)' }}>
            <div className="text-5xl mb-4">📲</div>
            <h3 className="text-white font-semibold text-lg mb-2">No tienes QR codes todavía</h3>
            <p className="text-gray-400 mb-6">Crea tu primer QR code dinámico con analytics</p>
            <Link href="/portal/qr-manager/create" className="px-8 py-3 rounded-xl text-white font-medium inline-block" style={{ background: '#0F3460' }}>Crear QR →</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {qrCodes.map(qr => (
              <div key={qr.id} className="rounded-xl p-5" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-white font-semibold">{qr.title}</h3>
                    <p className="text-gray-400 text-xs mt-1 truncate max-w-[180px]">{qr.destination_url}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${qr.is_active ? 'text-green-400' : 'text-gray-500'}`} style={{ background: qr.is_active ? 'rgba(52,211,153,0.1)' : 'rgba(156,163,175,0.1)' }}>
                    {qr.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'rgba(15,52,96,0.3)' }}>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">{qr.scan_count}</p>
                    <p className="text-gray-400 text-xs">Scans</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-gray-300">{qr.short_code}</p>
                    <p className="text-gray-400 text-xs">Código</p>
                  </div>
                  <a href={`/qr/${qr.short_code}`} target="_blank" className="px-3 py-1.5 rounded-lg text-xs text-white transition-all hover:opacity-90" style={{ background: 'rgba(15,52,96,0.4)', border: '1px solid rgba(15,52,96,0.5)' }}>
                    Ver →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
