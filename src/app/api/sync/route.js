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

  const pick = (camel, snake) => body[camel] ?? body[snake] ?? null
  const record = {
    author: body.author,
    type: body.type || 'synthesis',
    status: body.status || 'Active',
    title: body.title,
    key_takeaways: pick('keyTakeaways', 'key_takeaways'),
    content: body.content,
    implications: body.implications,
    next_steps: pick('nextSteps', 'next_steps'),
    linked_interview_ids: pick('linkedInterviewIds', 'linked_interview_ids') || [],
    linked_sync_ids: pick('linkedSyncIds', 'linked_sync_ids') || [],
  }

  Object.keys(record).forEach(k => { if (record[k] === null || record[k] === undefined) delete record[k] })

  let result
  if (body.id) {
    result = await supabase.from('syncs').update(record).eq('id', body.id).select().single()
  } else {
    result = await supabase.from('syncs').insert(record).select().single()
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 })

  await logSession(supabase, {
    author: record.author || 'unknown',
    action: body.id ? 'updated_sync' : 'created_sync',
    entity_type: 'sync',
    entity_id: result.data.id,
    summary: `[${record.type}] ${record.title}`
  })

  generateDigest({ trigger_type: 'auto', requested_by: record.author }).catch(console.error)
  return NextResponse.json({ success: true, data: result.data })
}

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { data, error } = await supabase.from('syncs').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
