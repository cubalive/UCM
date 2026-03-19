import { NextResponse } from 'next/server'
import { askClaudeJSON } from '@/lib/ai'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const system = `You are a world-class product strategist and startup advisor.
Analyze this business idea and create a comprehensive MVP roadmap.
Language: ${body.language === 'es' ? 'Spanish' : 'English'}
Budget level: ${body.budget}
Technical level of founder: ${body.techLevel}
Return ONLY valid JSON:
{
  "executiveSummary": "2-3 sentences summarizing the opportunity",
  "problemStatement": "clear problem description",
  "solution": "your proposed solution",
  "targetMarket": "specific target market with size estimate",
  "competitiveAdvantage": "what makes this unique",
  "estimatedCost": "realistic cost range for MVP",
  "timeToMarket": "realistic timeline",
  "phases": [
    {
      "phase": 1,
      "name": "Phase name",
      "duration": "X weeks/months",
      "cost": "$X - $Y",
      "milestone": "what success looks like",
      "features": ["feature1", "feature2", "feature3", "feature4"]
    }
  ],
  "techStack": {
    "frontend": "recommended frontend",
    "backend": "recommended backend",
    "database": "recommended database",
    "hosting": "recommended hosting",
    "extras": ["extra tool 1", "extra tool 2"]
  },
  "monetization": ["model 1 with details", "model 2 with details", "model 3 with details"],
  "risks": ["risk 1 with mitigation", "risk 2 with mitigation", "risk 3 with mitigation", "risk 4"],
  "nextSteps": ["immediate action 1", "action 2", "action 3", "action 4", "action 5"]
}`

  const message = `Analyze this idea:
Idea: ${body.idea}
Problem: ${body.problem || 'Not specified'}
Target user: ${body.targetUser || 'Not specified'}
Industry: ${body.industry || 'General'}
Budget: ${body.budget}
Timeline expectation: ${body.timeline}
Has team: ${body.hasTeam}
Technical level: ${body.techLevel}`

  try {
    const result = await askClaudeJSON(system, message, 8192)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI error' }, { status: 500 })
  }
}
