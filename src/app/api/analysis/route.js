import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()

  // Gather interview data for context
  const { data: interviews } = await supabase
    .from('interviews')
    .select('company, role, department, pain_points, biggest_signal, verbatim_quotes, tools_evaluated, why_failed, current_spend, willingness_to_pay, channels, org_type, annual_revenue')
    .order('date', { ascending: false })
    .limit(20)

  // Gather recent feed insights
  const { data: feedPosts } = await supabase
    .from('feed')
    .select('text, type, thread_tag')
    .in('type', ['insight', 'hypothesis', 'competitive'])
    .order('created_at', { ascending: false })
    .limit(15)

  const interviewContext = (interviews || []).map(i => {
    const pains = Array.isArray(i.pain_points) ? i.pain_points.map(p => `- ${p.description} (${p.category}, ${p.dollar_impact || 'unknown $'})`).join('\n') : ''
    return `Company: ${i.company || 'Unknown'} | Role: ${i.role || ''} | Org: ${i.org_type || ''} | Revenue: ${i.annual_revenue || ''}
Signal: ${i.biggest_signal || 'none'}
Pain points:\n${pains || 'none'}
Tools tried: ${i.tools_evaluated || 'none'} | Why failed: ${i.why_failed || ''} | Spend: ${i.current_spend || ''} | WTP: ${i.willingness_to_pay || ''}`
  }).join('\n\n')

  const feedContext = (feedPosts || []).map(f => {
    const text = (f.text || '').replace(/<[^>]*>/g, '').slice(0, 200)
    return `[${f.type}${f.thread_tag ? ` #${f.thread_tag}` : ''}] ${text}`
  }).join('\n')

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: `You are an expert CPG (Consumer Packaged Goods) industry analyst and startup strategist. You are advising two co-founders (Wes and Gibb) who are doing discovery research to find AI/software product opportunities in the CPG industry, specifically around mid-market manufacturers, brokers, and distributors.

Based on the interview data and research feed below, provide a concise opportunity analysis. Structure your response as:

**Market Signal** — The strongest pattern you see across interviews (1-2 sentences)

**Top 3 Opportunities** — Ranked by strength of signal, each with:
- Opportunity name
- Why now (market timing)
- Evidence strength (based on interview count and consistency)

**White Space** — One underexplored area worth investigating next

**Risk to Watch** — One key risk or assumption that needs validation

Be specific, cite company names and data points from the interviews. No generic advice. Write in a direct, analytical tone.`,
      messages: [{
        role: 'user',
        content: `Here is our interview data:\n\n${interviewContext}\n\nHere are recent research feed posts:\n\n${feedContext}`
      }],
    })

    const analysis = res.content[0].text

    return NextResponse.json({ success: true, analysis })
  } catch (err) {
    console.error('Analysis generation failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
