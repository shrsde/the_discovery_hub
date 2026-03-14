import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'text'
  const since = searchParams.get('since')

  let iq = supabase.from('interviews').select('*').order('date', { ascending: false })
  let fq = supabase.from('feed').select('*').order('created_at', { ascending: false })
  let sq = supabase.from('syncs').select('*').order('created_at', { ascending: false })

  if (since) {
    iq = iq.gte('updated_at', since)
    fq = fq.gte('created_at', since)
    sq = sq.gte('updated_at', since)
  }

  const [interviews, feedItems, syncItems] = await Promise.all([iq, fq, sq])

  const payload = {
    interviews: interviews.data || [],
    feed: feedItems.data || [],
    syncs: syncItems.data || [],
    exported_at: new Date().toISOString(),
    since: since || null,
  }

  if (format === 'json') return NextResponse.json(payload)

  // Structured text — optimized for pasting into Claude
  let out = `=== DISCOVERY HUB CONTEXT ===
Exported: ${payload.exported_at}
${since ? `Changes since: ${since}\n` : ''}Interviews: ${payload.interviews.length} | Feed: ${payload.feed.length} | Syncs: ${payload.syncs.length}

`

  if (payload.interviews.length) {
    out += '--- INTERVIEWS ---\n\n'
    payload.interviews.forEach((i, idx) => {
      const pains = (i.pain_points || []).filter(p => p.description)
      out += `[INT-${idx + 1}] ${i.company} / ${i.interviewee_name} (${i.date})
By: ${i.interviewer} | Role: ${i.role} | Dept: ${i.department} | Size: ${i.company_size}
Channels: ${(i.channels || []).join(', ')} | Distributors: ${i.distributors || ''}
Workflow: ${i.workflow_steps || ''}
Systems: ${i.systems_tools || ''} | Data: ${i.data_sources || ''}
Handoffs: ${i.handoffs || ''} | Time: ${i.time_spent || ''} | Workarounds: ${i.workarounds || ''}
Pains:
${pains.map((p, j) => `  ${j + 1}. ${p.description} [${p.category || ''}|${p.frequency || ''}|${p.dollar_impact || ''}] Who: ${p.who_feels || ''} Now: ${p.current_solution || ''}`).join('\n') || '  (none)'}
Solutions: Tried=${i.tools_evaluated || ''} Failed=${i.why_failed || ''} Spend=${i.current_spend || ''} Budget=${i.budget_authority || ''} WTP=${i.willingness_to_pay || ''}
Quotes: ${i.verbatim_quotes || ''}
Obs: ${i.observations || ''} | Surprises: ${i.surprises || ''}
Assessment: Intel=${i.intel_vs_judgement}% | ${i.outsourced_vs_insourced || ''} | ${i.autopilot_vs_copilot || ''}
Signal: ${i.biggest_signal || ''} | Confidence: ${i.confidence}/5
Scores: FF=${i.score_founder_fit} LF=${i.score_lowest_friction} CV=${i.score_clearest_value} D=${i.score_defensibility} DR=${i.score_ease_de_risk} S=${i.score_stickiness} T=${i.score_total}/30

`
    })
  }

  if (payload.syncs.length) {
    out += '--- SYNCS ---\n\n'
    payload.syncs.forEach(s => {
      out += `[${s.type.toUpperCase()}|${s.status}] ${s.title} — ${s.author} (${s.created_at?.split('T')[0]})
Takeaways: ${s.key_takeaways || ''}
Implications: ${s.implications || ''}
Next: ${s.next_steps || ''}
${s.content ? `Content: ${s.content}\n` : ''}
`
    })
  }

  if (payload.feed.length) {
    out += '--- FEED ---\n'
    payload.feed.forEach(f => {
      out += `[${f.created_at?.split('T')[0]}] ${f.author} (${f.type}): ${f.text}\n`
    })
  }

  return new NextResponse(out, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
