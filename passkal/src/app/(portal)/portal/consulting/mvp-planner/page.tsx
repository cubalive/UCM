'use client'

import { useState } from 'react'
import Link from 'next/link'

interface MVPPlan {
  executiveSummary: string
  problemStatement: string
  solution: string
  targetMarket: string
  phases: Array<{ phase: number; name: string; duration: string; features: string[]; cost: string; milestone: string }>
  techStack: { frontend: string; backend: string; database: string; hosting: string; extras: string[] }
  monetization: string[]
  competitiveAdvantage: string
  risks: string[]
  estimatedCost: string
  timeToMarket: string
  nextSteps: string[]
}

export default function MVPPlannerPage() {
  const [form, setForm] = useState({
    idea: '', problem: '', targetUser: '', industry: '',
    budget: 'bootstrap', timeline: '3-6 months',
    hasTeam: 'no', techLevel: 'non-technical', language: 'es',
  })
  const [plan, setPlan] = useState<MVPPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('summary')

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setPlan(null)
    try {
      const res = await fetch('/api/ai/mvp-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json() as MVPPlan
      setPlan(data)
      setActiveTab('summary')
    } finally {
      setLoading(false)
    }
  }

  const TABS = [
    { k: 'summary', l: 'Resumen' },
    { k: 'phases', l: 'Fases' },
    { k: 'tech', l: 'Tech Stack' },
    { k: 'money', l: 'Monetizacion' },
    { k: 'risks', l: 'Riesgos' },
    { k: 'nextsteps', l: 'Proximos pasos' },
  ]

  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/portal/consulting" className="text-gray-400 hover:text-white">Consulting</Link>
          <div>
            <h1 className="text-2xl font-bold text-white">MVP Roadmap Generator</h1>
            <p className="text-gray-400 text-sm">Describe tu idea — Claude genera el plan completo</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          <form onSubmit={generate} className="lg:col-span-2 space-y-4">
            <div className="rounded-xl p-5 space-y-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div>
                <label className="block text-sm text-gray-300 mb-2">Tu idea en una oracion *</label>
                <textarea value={form.idea} onChange={e => setForm(f => ({ ...f, idea: e.target.value }))} required rows={3}
                  placeholder="Ej: Una app que conecta medicos con pacientes para consultas virtuales en espanol en EE.UU."
                  className="w-full px-3 py-2.5 rounded-xl text-white text-sm placeholder-gray-500 outline-none resize-none"
                  style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-2">Que problema resuelve?</label>
                <textarea value={form.problem} onChange={e => setForm(f => ({ ...f, problem: e.target.value }))} rows={2}
                  placeholder="Ej: Los latinos en EE.UU. no encuentran medicos que hablen espanol y acepten sus seguros"
                  className="w-full px-3 py-2.5 rounded-xl text-white text-sm placeholder-gray-500 outline-none resize-none"
                  style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-2">Quien es tu usuario ideal?</label>
                <input value={form.targetUser} onChange={e => setForm(f => ({ ...f, targetUser: e.target.value }))}
                  placeholder="Ej: Latinos 25-50 anos en EE.UU. con seguro medico"
                  className="w-full px-3 py-2.5 rounded-xl text-white text-sm placeholder-gray-500 outline-none"
                  style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-2">Presupuesto disponible</label>
                <div className="flex gap-2">
                  {[{ k: 'bootstrap', l: '$0-5k' }, { k: 'seed', l: '$5k-50k' }, { k: 'funded', l: '$50k+' }].map(({ k, l }) => (
                    <button key={k} type="button" onClick={() => setForm(f => ({ ...f, budget: k }))}
                      className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                      style={{ background: form.budget === k ? '#0F3460' : 'rgba(15,52,96,0.1)', border: `1px solid ${form.budget === k ? '#60a5fa' : 'rgba(15,52,96,0.3)'}`, color: form.budget === k ? 'white' : '#9ca3af' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-2">Nivel tecnico</label>
                <div className="flex gap-2">
                  {[{ k: 'non-technical', l: 'No tecnico' }, { k: 'semi', l: 'Semi-tecnico' }, { k: 'technical', l: 'Tecnico' }].map(({ k, l }) => (
                    <button key={k} type="button" onClick={() => setForm(f => ({ ...f, techLevel: k }))}
                      className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                      style={{ background: form.techLevel === k ? '#0F3460' : 'rgba(15,52,96,0.1)', border: `1px solid ${form.techLevel === k ? '#60a5fa' : 'rgba(15,52,96,0.3)'}`, color: form.techLevel === k ? 'white' : '#9ca3af' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button type="submit" disabled={loading || !form.idea}
              className="w-full py-4 rounded-xl text-white font-semibold text-lg transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-3"
              style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
              {loading ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Analizando tu idea...</> : 'Generar MVP Roadmap completo'}
            </button>
          </form>

          <div className="lg:col-span-3">
            {!plan && !loading && (
              <div className="rounded-xl p-12 text-center h-full flex flex-col items-center justify-center" style={{ background: 'rgba(22,33,62,0.4)', border: '1px dashed rgba(15,52,96,0.4)' }}>
                <div className="text-5xl mb-4">🚀</div>
                <p className="text-white font-semibold mb-2">Tu plan de negocio en minutos</p>
                <p className="text-gray-400 text-sm text-center">Claude analizara tu idea y generara: roadmap de 3 fases, tech stack recomendado, costos estimados, riesgos y proximos pasos</p>
              </div>
            )}

            {loading && (
              <div className="rounded-xl p-12 text-center" style={{ background: 'rgba(22,33,62,0.4)' }}>
                <div className="w-16 h-16 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-6 mx-auto" />
                <p className="text-white font-semibold text-lg">Claude esta analizando tu idea...</p>
                <p className="text-gray-400 text-sm mt-2">Generando roadmap completo, tech stack y proyecciones</p>
                <p className="text-gray-500 text-xs mt-4">Esto puede tomar 30-40 segundos</p>
              </div>
            )}

            {plan && (
              <div>
                <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                  {TABS.map(({ k, l }) => (
                    <button key={k} onClick={() => setActiveTab(k)}
                      className="px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all shrink-0"
                      style={{ background: activeTab === k ? '#0F3460' : 'rgba(22,33,62,0.6)', border: `1px solid ${activeTab === k ? '#60a5fa' : 'rgba(15,52,96,0.3)'}`, color: activeTab === k ? 'white' : '#9ca3af' }}>
                      {l}
                    </button>
                  ))}
                </div>

                <div className="rounded-xl p-5 max-h-[580px] overflow-y-auto" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
                  {activeTab === 'summary' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg text-center" style={{ background: 'rgba(15,52,96,0.2)' }}>
                          <p className="text-blue-400 font-bold">{plan.timeToMarket}</p>
                          <p className="text-gray-400 text-xs">Time to market</p>
                        </div>
                        <div className="p-3 rounded-lg text-center" style={{ background: 'rgba(15,52,96,0.2)' }}>
                          <p className="text-green-400 font-bold">{plan.estimatedCost}</p>
                          <p className="text-gray-400 text-xs">Costo estimado</p>
                        </div>
                      </div>
                      {[
                        { title: 'Resumen ejecutivo', content: plan.executiveSummary },
                        { title: 'Problema', content: plan.problemStatement },
                        { title: 'Solucion', content: plan.solution },
                        { title: 'Mercado objetivo', content: plan.targetMarket },
                        { title: 'Ventaja competitiva', content: plan.competitiveAdvantage },
                      ].map(({ title, content }) => (
                        <div key={title} className="p-4 rounded-lg" style={{ background: 'rgba(15,52,96,0.1)', border: '1px solid rgba(15,52,96,0.2)' }}>
                          <p className="text-blue-400 font-semibold text-sm mb-2">{title}</p>
                          <p className="text-gray-300 text-sm leading-relaxed">{content}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'phases' && (
                    <div className="space-y-4">
                      {plan.phases?.map(phase => (
                        <div key={phase.phase} className="rounded-xl overflow-hidden">
                          <div className="px-4 py-3" style={{ background: 'rgba(15,52,96,0.3)' }}>
                            <div className="flex items-center justify-between">
                              <p className="text-white font-semibold">Fase {phase.phase}: {phase.name}</p>
                              <div className="flex gap-2">
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">{phase.duration}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">{phase.cost}</span>
                              </div>
                            </div>
                            <p className="text-yellow-400 text-xs mt-1">{phase.milestone}</p>
                          </div>
                          <div className="px-4 py-3" style={{ background: 'rgba(22,33,62,0.6)' }}>
                            <div className="flex flex-wrap gap-2">
                              {phase.features?.map(f => (
                                <span key={f} className="px-2 py-1 rounded-full text-xs text-gray-300" style={{ background: 'rgba(15,52,96,0.3)' }}>{f}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'tech' && plan.techStack && (
                    <div className="space-y-3">
                      {Object.entries(plan.techStack).map(([key, value]) => (
                        <div key={key} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'rgba(15,52,96,0.1)' }}>
                          <span className="text-gray-400 text-sm w-24 shrink-0 capitalize">{key}:</span>
                          <span className="text-white text-sm">{Array.isArray(value) ? value.join(', ') : value as string}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'money' && (
                    <div className="space-y-3">
                      {plan.monetization?.map((m, i) => (
                        <div key={i} className="p-4 rounded-lg flex gap-3" style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)' }}>
                          <span className="text-yellow-400 font-bold text-sm w-6 shrink-0">{i + 1}.</span>
                          <p className="text-gray-300 text-sm">{m}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'risks' && (
                    <div className="space-y-3">
                      {plan.risks?.map((risk, i) => (
                        <div key={i} className="p-4 rounded-lg flex gap-3" style={{ background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)' }}>
                          <span className="text-red-400 text-sm shrink-0">!</span>
                          <p className="text-gray-300 text-sm">{risk}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'nextsteps' && (
                    <div className="space-y-3">
                      {plan.nextSteps?.map((s, i) => (
                        <div key={i} className="p-4 rounded-lg flex gap-3" style={{ background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.15)' }}>
                          <span className="text-green-400 font-bold text-sm w-6 shrink-0">{i + 1}.</span>
                          <p className="text-gray-300 text-sm">{s}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
