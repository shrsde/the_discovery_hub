import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest, logSession } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  const record = {
    title: body.title,
    organizer: body.organizer,
    scheduled_at: body.scheduled_at || body.scheduledAt || null,
    attendees: body.attendees || ['Wes', 'Gibb'],
    meet_link: 'https://meet.google.com/new',
    status: 'scheduled',
  }

  const { data, error } = await supabase.from('meetings').insert(record).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Also post to feed
  await supabase.from('feed').insert({
    author: record.organizer,
    type: 'meeting',
    text: `Scheduled meeting: ${record.title}`,
    tags: record.attendees,
  }).catch(() => {})

  await logSession(supabase, {
    author: record.organizer,
    action: 'created_meeting',
    entity_type: 'meeting',
    entity_id: data.id,
    summary: `Meeting: ${record.title}`,
  })

  return NextResponse.json({ success: true, data })
}

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function PATCH(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates = {}
  if (body.status !== undefined) updates.status = body.status
  if (body.transcript !== undefined) updates.transcript = body.transcript
  if (body.recording_url !== undefined) updates.recording_url = body.recording_url

  // If transcript provided, generate AI summary
  if (body.transcript) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const res = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: 'You are summarizing a meeting between co-founders doing CPG industry discovery research. Extract: key decisions, action items (with owner: Wes or Gibb), insights, and next steps. Be concise and actionable.',
        messages: [{ role: 'user', content: `Meeting transcript:\n\n${body.transcript}` }],
      })
      updates.parsed_summary = res.content[0].text
    } catch (e) {
      console.error('Meeting summary failed:', e)
    }
  }

  const { data, error } = await supabase
    .from('meetings')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
