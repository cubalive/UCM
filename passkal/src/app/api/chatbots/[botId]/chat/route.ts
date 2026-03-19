import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { askClaude } from '@/lib/ai'

export async function POST(req: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params
  const { message } = await req.json() as { message: string }
  const supabase = createAdminClient()

  const { data: session } = await supabase.from('ai_conversations')
    .select('messages').eq('session_id', `bot-${botId}`).single()

  if (!session) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  const systemMsg = (session.messages as { role: string; content: string }[]).find(m => m.role === 'system')
  const system = systemMsg?.content ?? 'You are a helpful customer service assistant.'

  try {
    const reply = await askClaude(system, message, 500)
    return NextResponse.json({ reply })
  } catch {
    return NextResponse.json({ reply: 'Sorry, I am temporarily unavailable. Please try again.' })
  }
}
