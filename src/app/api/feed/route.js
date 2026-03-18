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
    tags: body.tags || [],
    media_url: body.media_url || body.mediaUrl || null,
    media_type: body.media_type || body.mediaType || null,
    media_name: body.media_name || body.mediaName || null,
    summary: body.summary || null,
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

  // Create in-app notifications + email for @mentions
  if (record.tags && record.tags.length > 0) {
    // In-app notifications
    for (const tag of record.tags) {
      if (tag === record.author) continue
      try {
        await supabase.from('notifications').insert({
          recipient: tag,
          author: record.author,
          feed_id: data.id,
          preview: (record.text || '').replace(/<[^>]*>/g, '').slice(0, 100),
        })
      } catch (e) { console.error('In-app notification failed:', e) }
    }

    // Email notifications
    try {
      const baseUrl = request.url.split('/api/')[0]
      await fetch(`${baseUrl}/api/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': request.headers.get('authorization') || '',
        },
        body: JSON.stringify({
          tags: record.tags,
          author: record.author,
          text: record.text,
          type: record.type,
        }),
      })
    } catch (e) { console.error('Email notification failed:', e) }
  }

  return NextResponse.json({ success: true, data })
}

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') || 'active' // active, archived, all

  let query = supabase.from('feed').select('*').order('created_at', { ascending: false })

  if (view === 'active') query = query.eq('archived', false)
  else if (view === 'archived') query = query.eq('archived', true)

  const { data, error } = await query
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
  if (body.pinned !== undefined) updates.pinned = body.pinned
  if (body.archived !== undefined) updates.archived = body.archived
  if (body.summary !== undefined) updates.summary = body.summary
  if (body.text !== undefined) {
    updates.text = body.text
    updates.edited_at = new Date().toISOString()
  }
  if (body.type !== undefined) updates.type = body.type

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase.from('feed').update(updates).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, data })
}

export async function DELETE(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabase.from('feed').delete().eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
