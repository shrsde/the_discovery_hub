import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const { transcript, interviewer } = await request.json()
    if (!transcript) return NextResponse.json({ error: 'Missing transcript field' }, { status: 400 })

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are an expert at extracting structured interview data from raw transcripts. You will receive a transcript of a CPG industry discovery interview.

Extract as much information as possible and return a JSON object with these fields. Use null for any field you cannot determine from the transcript. Be thorough — capture verbatim quotes exactly as spoken.

Return ONLY valid JSON, no markdown code blocks, no explanation:

{
  "interviewee_name": "string or null",
  "company": "string or null",
  "role": "string or null",
  "department": "string or null",
  "company_size": "string or null — revenue, employee count, etc.",
  "channels": ["array of: Retail, Foodservice, DTC, Club, Convenience, E-commerce"],
  "distributors": "string or null — e.g. UNFI, KeHE, Sysco",
  "connection_source": "string or null — how the interview was arranged",
  "workflow_steps": "string or null — describe their primary workflow",
  "systems_tools": "string or null — software/tools they use",
  "data_sources": "string or null — where they get data",
  "handoffs": "string or null — who passes work to whom",
  "time_spent": "string or null — how much time on key tasks",
  "workarounds": "string or null — manual processes, hacks",
  "pain_points": [
    {
      "description": "verbatim or close to verbatim pain statement",
      "category": "Overhead Savings | Revenue Adder | Risk Reduction | Speed/Efficiency",
      "dollar_impact": "string or null",
      "frequency": "Daily | Weekly | Monthly | Quarterly | Annually | Ad-hoc",
      "who_feels": "string or null — which team/role",
      "current_solution": "string or null — how they handle it now"
    }
  ],
  "tools_evaluated": "string or null — tools they've tried",
  "why_failed": "string or null — why those tools didn't work",
  "current_spend": "string or null — what they spend on solutions",
  "budget_authority": "string or null — who controls budget",
  "willingness_to_pay": "string or null — would they pay, how much",
  "integration_reqs": "string or null — what it needs to integrate with",
  "verbatim_quotes": "string — the most striking direct quotes, separated by newlines",
  "observations": "string or null — notable things about their workflow/attitude",
  "surprises": "string or null — anything unexpected",
  "follow_ups": "string or null — suggested follow-up actions",
  "biggest_signal": "string or null — the clearest opportunity signal from this interview",
  "intel_vs_judgement": "number 0-100 — how much of their work is intelligence (data gathering/processing) vs judgement (decisions requiring expertise). Higher = more intelligence-based",
  "outsourced_vs_insourced": "Fully outsourced | Mostly outsourced | Split | Mostly insourced | Fully insourced | null",
  "autopilot_vs_copilot": "Autopilot | Copilot | Hybrid | Unclear | null",
  "confidence": "number 1-5 — how confident are you in the quality/depth of this interview data",
  "notes": "string or null — any additional context worth capturing"
}

Guidelines:
- Extract up to 3 pain points, prioritizing those with clear dollar impact or strong emotional language
- For verbatim_quotes, capture the most vivid/specific statements — "I wish..." and "We spend X hours..." type statements
- For intel_vs_judgement, estimate based on how much of their described work is routine data processing vs. requiring human expertise
- For confidence, rate based on how much useful data the transcript contains (5 = very detailed, 1 = sparse)
- If the transcript is a conversation, extract the interviewee's statements, not the interviewer's`,
      messages: [
        {
          role: 'user',
          content: `Here is the interview transcript:\n\n${transcript}`
        }
      ],
    })

    const text = response.content[0].text
    let parsed
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
    }

    // Add interviewer if provided
    if (interviewer) parsed.interviewer = interviewer

    return NextResponse.json({ success: true, data: parsed })
  } catch (err) {
    console.error('Import error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
