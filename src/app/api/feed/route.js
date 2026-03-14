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

  const record = {
    author: body.author,
    type: body.type || 'insight',
    text: body.text,
    linked_interview_id: body.linkedInterviewId || body.linked_interview_id || null,
  }

  const { data, error } = await supabase.from('feed').insert(record).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logSession(supabase, {
    author: record.author,
    action: 'posted_feed',
    entity_type: 'feed',
    entity_id: data.id,
    summary: `[${record.type}] ${record.text.slice(0, 80)}`
  })

  if (['hypothesis', 'challenge', 'action'].includes(record.type)) {
    generateDigest({ trigger_type: 'auto', requested_by: record.author }).catch(console.error)
  }

  return NextResponse.json({ success: true, data })
}

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { data, error } = await supabase.from('feed').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
