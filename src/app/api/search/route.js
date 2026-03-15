import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const { query } = await request.json()
    if (!query) return NextResponse.json({ error: 'Missing query field' }, { status: 400 })

    const supabase = createServerClient()

    // Pull all data
    const [interviews, feed, syncs, attachments, meetings] = await Promise.all([
      supabase.from('interviews').select('*').order('date', { ascending: false }),
      supabase.from('feed').select('*').order('created_at', { ascending: false }),
      supabase.from('syncs').select('*').order('created_at', { ascending: false }),
      supabase.from('attachments').select('*').order('created_at', { ascending: false }),
      supabase.from('meetings').select('*').order('created_at', { ascending: false }),
    ])

    // Build context for Claude
    const context = buildContext(interviews.data || [], feed.data || [], syncs.data || [], attachments.data || [], meetings.data || [])

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `You are a search assistant for a CPG discovery research database. You have access to the full database of interviews, feed posts, sync entries, file attachments, and meeting transcripts.

When answering queries:
- Be specific — cite company names, interviewee names, dates, and exact quotes when relevant
- Reference the source type (interview, feed post, or sync) and who authored it
- If the query asks for patterns, synthesize across multiple entries
- If nothing matches, say so clearly
- Keep answers concise and actionable
- Return your response as JSON with this structure:
{
  "answer": "Your natural language answer to the query",
  "sources": [
    {
      "type": "interview" | "feed" | "sync",
      "id": "uuid",
      "title": "Company name or post preview",
      "relevance": "Why this source is relevant"
    }
  ]
}`,
      messages: [
        {
          role: 'user',
          content: `Here is the full database:\n\n${context}\n\n---\n\nQuery: ${query}`
        }
      ],
    })

    const text = response.content[0].text
    let parsed
    try {
      // Try to parse as JSON (Claude may wrap in markdown code blocks)
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { answer: text, sources: [] }
    }

    return NextResponse.json({ success: true, ...parsed })
  } catch (err) {
    console.error('Search error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function buildContext(interviews, feed, syncs, attachments = [], meetings = []) {
  let out = ''

  if (interviews.length) {
    out += '=== INTERVIEWS ===\n\n'
    interviews.forEach(i => {
      const pains = (i.pain_points || []).filter(p => p.description)
      out += `[ID: ${i.id}] ${i.company} / ${i.interviewee_name} (${i.date})
Interviewer: ${i.interviewer} | Role: ${i.role} | Dept: ${i.department} | Size: ${i.company_size}
Channels: ${(i.channels || []).join(', ')} | Distributors: ${i.distributors || ''}
Workflow: ${i.workflow_steps || ''}
Systems: ${i.systems_tools || ''} | Data Sources: ${i.data_sources || ''}
Pain Points:
${pains.map(p => `  - ${p.description} [Category: ${p.category || 'N/A'}, Impact: ${p.dollar_impact || 'N/A'}, Frequency: ${p.frequency || 'N/A'}, Who: ${p.who_feels || 'N/A'}, Current Solution: ${p.current_solution || 'N/A'}]`).join('\n') || '  (none)'}
Tools Tried: ${i.tools_evaluated || ''} | Why Failed: ${i.why_failed || ''}
Current Spend: ${i.current_spend || ''} | Budget Authority: ${i.budget_authority || ''} | WTP: ${i.willingness_to_pay || ''}
Quotes: ${i.verbatim_quotes || ''}
Observations: ${i.observations || ''} | Surprises: ${i.surprises || ''}
Signal: ${i.biggest_signal || ''} | Confidence: ${i.confidence}/5
Intel vs Judgement: ${i.intel_vs_judgement}% | ${i.outsourced_vs_insourced || ''} | ${i.autopilot_vs_copilot || ''}
Scores: Founder Fit=${i.score_founder_fit} Friction=${i.score_lowest_friction} Value=${i.score_clearest_value} Defensibility=${i.score_defensibility} De-risk=${i.score_ease_de_risk} Stickiness=${i.score_stickiness} TOTAL=${i.score_total}/30
Notes: ${i.notes || ''}

`
    })
  }

  if (syncs.length) {
    out += '=== SYNCS ===\n\n'
    syncs.forEach(s => {
      out += `[ID: ${s.id}] [${s.type}|${s.status}] ${s.title} — by ${s.author} (${s.created_at?.split('T')[0]})
Key Takeaways: ${s.key_takeaways || ''}
Implications: ${s.implications || ''}
Next Steps: ${s.next_steps || ''}
Content: ${s.content || '(none)'}

`
    })
  }

  if (feed.length) {
    out += '=== FEED ===\n\n'
    feed.forEach(f => {
      out += `[ID: ${f.id}] [${f.created_at}] ${f.author} (${f.type}): ${f.text}\n`
    })
  }

  if (attachments.length) {
    out += '\n=== ATTACHMENTS ===\n\n'
    attachments.forEach(a => {
      out += `[ID: ${a.id}] File: ${a.file_name} (${a.file_type}) — attached to interview ${a.interview_id}
${a.summary ? `Summary: ${a.summary}` : ''}
${a.parsed_text ? `Content: ${a.parsed_text.slice(0, 500)}` : ''}

`
    })
  }

  if (meetings.length) {
    out += '\n=== MEETINGS ===\n\n'
    meetings.forEach(m => {
      out += `[ID: ${m.id}] ${m.title} — ${m.organizer} (${m.status}, ${m.created_at?.split('T')[0]})
${m.parsed_summary ? `Summary: ${m.parsed_summary}` : ''}
${m.transcript ? `Transcript: ${m.transcript.slice(0, 1000)}` : ''}

`
    })
  }

  return out
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
