import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
export default async function PromoCalendarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: org } = await supabase.from('organizations').select('id').eq('owner_id', user.id).single()
  const { data: scheduled } = org ? await supabase.from('content_pieces').select('*').eq('org_id', org.id).not('scheduled_at', 'is', null).order('scheduled_at', { ascending: true }).limit(20) : { data: [] }
  const platformIcons: Record<string, string> = { instagram: '📸', facebook: '👥', tiktok: '🎵', google_ads: '🔍', linkedin: '💼', twitter: '🐦' }
  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Calendario de Contenido</h1>
            <p className="text-gray-400 mt-1">Contenido programado para publicación</p>
          </div>
          <Link href="/portal/promo-engine/create" className="px-6 py-3 rounded-xl text-white font-medium" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
            + Crear contenido
          </Link>
        </div>
        {!scheduled || scheduled.length === 0 ? (
          <div className="rounded-2xl p-16 text-center" style={{ background: 'rgba(22,33,62,0.6)', border: '1px dashed rgba(15,52,96,0.4)' }}>
            <div className="text-5xl mb-4">📅</div>
            <h3 className="text-white font-semibold text-lg mb-2">No hay contenido programado</h3>
            <p className="text-gray-400 mb-6">Crea contenido y prográmalo para publicación automática</p>
            <Link href="/portal/promo-engine/create" className="px-8 py-3 rounded-xl text-white font-medium inline-block" style={{ background: '#0F3460' }}>Crear y programar →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {scheduled.map(piece => {
              const content = piece.generated_content as Record<string, unknown>
              return (
                <div key={piece.id} className="rounded-xl p-4 flex items-center gap-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
                  <div className="text-2xl">{platformIcons[piece.platform] ?? '📄'}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{(content?.caption as string)?.slice(0, 60) ?? piece.content_type}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{piece.platform} · {piece.content_type}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white text-sm">{new Date(piece.scheduled_at).toLocaleDateString('es-US', { month: 'short', day: 'numeric' })}</p>
                    <p className="text-gray-400 text-xs">{new Date(piece.scheduled_at).toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <span className="px-2 py-1 rounded-full text-xs font-medium shrink-0" style={{ background: piece.status === 'published' ? 'rgba(52,211,153,0.1)' : 'rgba(96,165,250,0.1)', color: piece.status === 'published' ? '#34d399' : '#60a5fa' }}>
                    {piece.status}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
