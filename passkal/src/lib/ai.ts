export async function askClaude(systemPrompt: string, userMessage: string, maxTokens = 1024): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return 'AI service not configured.'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  const data = await res.json()
  return data.content?.[0]?.text || 'No response from AI.'
}

export async function askClaudeJSON(systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<any> {
  const text = await askClaude(systemPrompt, userMessage, maxTokens)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in response')
  return JSON.parse(jsonMatch[0])
}
