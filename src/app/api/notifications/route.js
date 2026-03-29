import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

// GET — list notifications for a user
export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const { searchParams } = new URL(request.url)
  const recipient = searchParams.get('recipient')
  if (!recipient) return NextResponse.json({ error: 'Missing recipient' }, { status: 400 })

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient', recipient)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

// POST — create a notification (called internally when someone is tagged)
export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  const { tags, author, feed_id, preview } = body
  if (!tags || tags.length === 0) return NextResponse.json({ success: true, created: 0 })

  let created = 0
  for (const tag of tags) {
    if (tag === author) continue // don't notify yourself
    await supabase.from('notifications').insert({
      recipient: tag,
      author,
      feed_id: feed_id || null,
      preview: (preview || '').replace(/<[^>]*>/g, '').slice(0, 100),
    })
    created++
  }

  return NextResponse.json({ success: true, created })
}

// PATCH — mark notifications as read
export async function PATCH(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const { recipient, ids } = await request.json()
  const supabase = createServerClient()

  if (ids) {
    // Mark specific notifications as read
    await supabase.from('notifications').update({ read: true }).in('id', ids)
  } else if (recipient) {
    // Mark all as read for a user
    await supabase.from('notifications').update({ read: true }).eq('recipient', recipient).eq('read', false)
  }

  return NextResponse.json({ success: true })
}

// DELETE — delete specific notification or clear all for a user
export async function DELETE(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (body.id) {
    await supabase.from('notifications').delete().eq('id', body.id)
  } else if (body.recipient) {
    await supabase.from('notifications').delete().eq('recipient', body.recipient)
  } else {
    return NextResponse.json({ error: 'Missing id or recipient' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
