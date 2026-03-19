import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { nanoid } from 'nanoid'

export async function POST(req: Request) {
  const body = await req.json()
  const botId = nanoid(12)
  const supabase = createAdminClient()

  await supabase.from('ai_conversations').insert({
    session_id: `bot-${botId}`,
    messages: [{
      role: 'system',
      content: `You are ${body.name}, the AI assistant for ${body.businessName}.
Language: ${body.language === 'es' ? 'Spanish' : 'English'}
Industry: ${body.industry}
${body.description ? `About: ${body.description}` : ''}
${body.faq ? `FAQ:\n${body.faq}` : ''}
${body.products ? `Products/Services:\n${body.products}` : ''}
${body.policies ? `Policies:\n${body.policies}` : ''}
Rules: Be helpful, concise (max 3 sentences), friendly. If you don't know something, say "Let me connect you with our team at [contact info]".`,
    }],
    metadata: { botId, config: body },
  })

  return NextResponse.json({ botId })
}
