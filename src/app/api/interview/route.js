import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest, logSession } from '@/lib/auth'
import { generateDigest } from '@/lib/digest'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  // Accept both camelCase and snake_case
  const pick = (camel, snake) => body[camel] ?? body[snake] ?? null
  const record = {
    date: body.date || new Date().toISOString().split('T')[0],
    interviewer: body.interviewer,
    interviewee_name: pick('intervieweeName', 'interviewee_name'),
    company: body.company,
    role: body.role,
    department: body.department,
    company_size: pick('companySize', 'company_size'),
    channels: body.channels || [],
    distributors: body.distributors,
    connection_source: pick('connectionSource', 'connection_source'),
    workflow_steps: pick('workflowSteps', 'workflow_steps'),
    systems_tools: pick('systemsTools', 'systems_tools'),
    data_sources: pick('dataSources', 'data_sources'),
    handoffs: body.handoffs,
    time_spent: pick('timeSpent', 'time_spent'),
    workarounds: body.workarounds,
    pain_points: pick('painPoints', 'pain_points'),
    tools_evaluated: pick('toolsEvaluated', 'tools_evaluated'),
    why_failed: pick('whyFailed', 'why_failed'),
    current_spend: pick('currentSpend', 'current_spend'),
    budget_authority: pick('budgetAuthority', 'budget_authority'),
    willingness_to_pay: pick('willingnessToPay', 'willingness_to_pay'),
    integration_reqs: pick('integrationReqs', 'integration_reqs'),
    verbatim_quotes: pick('verbatimQuotes', 'verbatim_quotes'),
    observations: body.observations,
    surprises: body.surprises,
    follow_ups: pick('followUps', 'follow_ups'),
    intel_vs_judgement: pick('intelVsJudgement', 'intel_vs_judgement') ?? 50,
    outsourced_vs_insourced: pick('outsourcedVsInsourced', 'outsourced_vs_insourced'),
    autopilot_vs_copilot: pick('autopilotVsCopilot', 'autopilot_vs_copilot'),
    biggest_signal: pick('biggestSignal', 'biggest_signal'),
    confidence: body.confidence || 3,
    score_founder_fit: body.scores?.founderFit ?? pick('scoreFounderFit', 'score_founder_fit') ?? 0,
    score_lowest_friction: body.scores?.lowestFriction ?? pick('scoreLowestFriction', 'score_lowest_friction') ?? 0,
    score_clearest_value: body.scores?.clearestValue ?? pick('scoreClearestValue', 'score_clearest_value') ?? 0,
    score_defensibility: body.scores?.defensibility ?? pick('scoreDefensibility', 'score_defensibility') ?? 0,
    score_ease_de_risk: body.scores?.easeDeRisk ?? pick('scoreEaseDeRisk', 'score_ease_de_risk') ?? 0,
    score_stickiness: body.scores?.stickiness ?? pick('scoreStickiness', 'score_stickiness') ?? 0,
    notes: body.notes,
    workflow_graph: pick('workflowGraph', 'workflow_graph'),
    status: body.status || 'completed',
    scheduled_at: pick('scheduledAt', 'scheduled_at'),
    meet_link: pick('meetLink', 'meet_link'),
    // Org profile fields
    org_type: body.org_type,
    annual_revenue: body.annual_revenue,
    channel_mix: body.channel_mix,
    tech_stack: body.tech_stack,
    tech_stack_other: body.tech_stack_other,
    org_headcount: body.org_headcount,
    brokers: body.brokers,
    supply_chain_product: body.supply_chain_product,
    distribution_models: body.distribution_models,
    // Broker fields
    broker_channel_focus: body.broker_channel_focus,
    broker_primary_account: body.broker_primary_account,
    broker_client_count: body.broker_client_count,
    broker_client_size: body.broker_client_size,
    broker_geographic: body.broker_geographic,
    // Distributor fields
    distributor_channel: body.distributor_channel,
    distributor_type: body.distributor_type,
    // Internal notes
    internal_notes_details: body.internal_notes_details,
    internal_notes_org: body.internal_notes_org,
    internal_notes_workflow: body.internal_notes_workflow,
    internal_notes_pain: body.internal_notes_pain,
    internal_notes_solution: body.internal_notes_solution,
    internal_notes_quotes: body.internal_notes_quotes,
    internal_notes_assessment: body.internal_notes_assessment,
  }

  // Remove null values so Supabase uses defaults
  Object.keys(record).forEach(k => { if (record[k] === null || record[k] === undefined) delete record[k] })

  let result
  if (body.id) {
    result = await supabase.from('interviews').update(record).eq('id', body.id).select().single()
  } else {
    result = await supabase.from('interviews').insert(record).select().single()
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 })

  const interviewData = result.data

  await logSession(supabase, {
    author: record.interviewer || 'unknown',
    action: body.id ? 'updated_interview' : 'created_interview',
    entity_type: 'interview',
    entity_id: interviewData.id,
    summary: `${body.id ? 'Updated' : 'New'} interview: ${record.company} / ${record.interviewee_name}`
  })

  // When an interview is marked completed, create a feed post
  if (body.id && record.status === 'completed') {
    try {
      // Check if a feed post for this interview already exists
      const { data: existingPosts } = await supabase
        .from('feed')
        .select('id')
        .eq('linked_interview_id', interviewData.id)
        .limit(1)

      if (!existingPosts || existingPosts.length === 0) {
        const name = interviewData.interviewee_name || 'Unknown'
        const company = interviewData.company || 'Unknown'
        const signal = interviewData.biggest_signal || ''
        const painPoints = Array.isArray(interviewData.pain_points) ? interviewData.pain_points : []
        const painSummary = painPoints.slice(0, 3).map(p => p.description || p).join('; ')
        const quotes = (interviewData.verbatim_quotes || '').split('\n').filter(Boolean).slice(0, 2).join(' | ')
        const interviewer = interviewData.interviewer || 'Wes'

        let summaryParts = []
        if (signal) summaryParts.push(signal)
        if (painSummary) summaryParts.push(`Pain points: ${painSummary}`)
        if (quotes) summaryParts.push(`"${quotes}"`)
        const summaryText = summaryParts.join('\n\n') || 'Interview completed.'

        await supabase.from('feed').insert({
          author: interviewer,
          type: 'insight',
          text: `<strong>Interview completed: ${name}</strong> — ${company}`,
          tags: ['Wes', 'Gibb'].filter(n => n !== interviewer),
          summary: summaryText,
          linked_interview_id: interviewData.id,
        })

        // Notify the other user
        const otherUser = interviewer === 'Wes' ? 'Gibb' : 'Wes'
        await supabase.from('notifications').insert({
          recipient: otherUser,
          author: interviewer,
          preview: `Interview with ${name} at ${company} completed`,
        }).catch(() => {})

        try {
          const { sendPushToUser } = await import('@/lib/push')
          await sendPushToUser(otherUser, {
            title: `Interview completed: ${name}`,
            body: `${company} — ${signal || 'View details'}`,
            url: `/interviews/${interviewData.id}`,
          })
        } catch (e) { console.error('Push failed:', e) }
      }
    } catch (e) { console.error('Interview feed post failed:', e) }
  }

  generateDigest({ trigger_type: 'auto', requested_by: record.interviewer }).catch(console.error)
  return NextResponse.json({ success: true, data: interviewData })
}

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { data, error } = await supabase.from('interviews').select('*').order('date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function DELETE(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const { id, ids } = await request.json()
  const supabase = createServerClient()

  if (ids && ids.length > 0) {
    const { error } = await supabase.from('interviews').delete().in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else if (id) {
    const { error } = await supabase.from('interviews').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    return NextResponse.json({ error: 'Missing id or ids' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
