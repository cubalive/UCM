import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const { data: lead } = await admin.from('leads').select('*').eq('id', id).single()
  if (!lead) notFound()
  const statusColors: Record<string, string> = {
    new: '#60a5fa', contacted: '#fbbf24', qualified: '#a78bfa',
    proposal: '#fb923c', negotiation: '#f472b6', won: '#34d399', lost: '#f87171'
  }
  const classColors: Record<string, string> = { hot: '#f87171', warm: '#fbbf24', cold: '#60a5fa' }
  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/leads" className="text-gray-400 hover:text-white transition-colors">← Leads</Link>
          <h1 className="text-2xl font-bold text-white">{lead.name ?? 'Lead sin nombre'}</h1>
          {lead.ai_classification && (
            <span className="px-3 py-1 rounded-full text-sm font-bold" style={{ background: `${classColors[lead.ai_classification]}20`, color: classColors[lead.ai_classification] }}>
              {lead.ai_classification.toUpperCase()}
            </span>
          )}
        </div>
        <div className="grid md:grid-cols-3 gap-6 mb-6">
          <div className="md:col-span-2 space-y-6">
            <div className="rounded-xl p-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <h2 className="text-white font-semibold mb-4">Información de contacto</h2>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Email', value: lead.email },
                  { label: 'Teléfono', value: lead.phone },
                  { label: 'Empresa', value: lead.company },
                  { label: 'Industria', value: lead.industry },
                  { label: 'Website', value: lead.website },
                  { label: 'Fuente', value: lead.source },
                  { label: 'Presupuesto', value: lead.budget_range },
                  { label: 'Timeline', value: lead.timeline },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-gray-400 text-xs mb-1">{label}</p>
                    <p className="text-white text-sm">{value ?? '—'}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl p-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <h2 className="text-white font-semibold mb-4">🤖 Análisis AI</h2>
              <div className="space-y-4">
                {lead.ai_summary && (
                  <div>
                    <p className="text-gray-400 text-xs mb-1">Resumen</p>
                    <p className="text-white text-sm">{lead.ai_summary}</p>
                  </div>
                )}
                {lead.ai_next_action && (
                  <div>
                    <p className="text-gray-400 text-xs mb-1">Próxima acción recomendada</p>
                    <p className="text-blue-400 text-sm font-medium">{lead.ai_next_action}</p>
                  </div>
                )}
                {lead.ai_recommended_service && (
                  <div>
                    <p className="text-gray-400 text-xs mb-1">Servicio recomendado</p>
                    <p className="text-green-400 text-sm">{lead.ai_recommended_service}</p>
                  </div>
                )}
                {lead.problem_described && (
                  <div>
                    <p className="text-gray-400 text-xs mb-1">Problema descrito</p>
                    <p className="text-white text-sm">{lead.problem_described}</p>
                  </div>
                )}
                {Array.isArray(lead.ai_red_flags) && lead.ai_red_flags.length > 0 && (
                  <div>
                    <p className="text-gray-400 text-xs mb-2">⚠️ Red flags</p>
                    <div className="flex flex-wrap gap-2">
                      {(lead.ai_red_flags as string[]).map((flag: string) => (
                        <span key={flag} className="px-2 py-1 rounded-full text-xs" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>{flag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {Array.isArray(lead.intake_transcript) && lead.intake_transcript.length > 0 && (
              <div className="rounded-xl p-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
                <h2 className="text-white font-semibold mb-4">💬 Transcripción del intake</h2>
                <div className="space-y-2">
                  {(lead.intake_transcript as Array<{role: string; content: string}>).map((msg, i) => (
                    <div key={i} className="text-sm p-3 rounded-lg" style={{ background: msg.role === 'user' ? 'rgba(15,52,96,0.3)' : 'rgba(83,52,131,0.2)' }}>
                      <span className="text-xs font-medium" style={{ color: msg.role === 'user' ? '#60a5fa' : '#a78bfa' }}>{msg.role === 'user' ? 'Prospecto' : 'AI'}: </span>
                      <span className="text-gray-300">{msg.content}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="rounded-xl p-5" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <h3 className="text-white font-semibold mb-4">Estado</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-gray-400 text-xs mb-1">Status</p>
                  <span className="px-3 py-1 rounded-full text-sm font-medium" style={{ background: `${statusColors[lead.status] ?? '#60a5fa'}20`, color: statusColors[lead.status] ?? '#60a5fa' }}>{lead.status}</span>
                </div>
                {lead.ai_score && (
                  <div>
                    <p className="text-gray-400 text-xs mb-2">AI Score</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-gray-700 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${lead.ai_score * 10}%`, background: lead.ai_score >= 7 ? '#34d399' : lead.ai_score >= 4 ? '#fbbf24' : '#f87171' }} />
                      </div>
                      <span className="text-white font-bold text-sm">{lead.ai_score}/10</span>
                    </div>
                  </div>
                )}
                {lead.ai_deal_size && (
                  <div>
                    <p className="text-gray-400 text-xs mb-1">Deal size</p>
                    <p className="text-white text-sm capitalize">{lead.ai_deal_size}</p>
                  </div>
                )}
                <div>
                  <p className="text-gray-400 text-xs mb-1">Creado</p>
                  <p className="text-white text-sm">{new Date(lead.created_at).toLocaleDateString('es-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              </div>
            </div>
            <Link href={`mailto:${lead.email}`} className="w-full py-3 rounded-xl text-white text-sm font-medium text-center block transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
              📧 Contactar ahora
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
