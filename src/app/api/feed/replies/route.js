import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const { searchParams } = new URL(request.url)
  const feedId = searchParams.get('feed_id')
  if (!feedId) return NextResponse.json({ error: 'Missing feed_id' }, { status: 400 })

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('feed_replies')
    .select('*')
    .eq('feed_id', feedId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const { feed_id, author, text } = body

  if (!feed_id || !author || !text?.trim()) {
    return NextResponse.json({ error: 'Missing feed_id, author, or text' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Insert reply
  const { data, error } = await supabase
    .from('feed_replies')
    .insert({ feed_id, author, text: text.trim() })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Update reply count and last_reply_at on parent post
  const { data: replies } = await supabase
    .from('feed_replies')
    .select('id')
    .eq('feed_id', feed_id)

  await supabase
    .from('feed')
    .update({
      reply_count: replies?.length || 1,
      last_reply_at: new Date().toISOString(),
    })
    .eq('id', feed_id)

  // Create notification for the other user
  const otherUser = author === 'Wes' ? 'Gibb' : 'Wes'
  try {
    await supabase.from('notifications').insert({
      recipient: otherUser,
      author,
      feed_id,
      preview: `replied: ${text.replace(/<[^>]*>/g, '').slice(0, 100)}`,
    })

    const { sendPushToUser } = await import('@/lib/push')
    await sendPushToUser(otherUser, {
      title: `${author} replied`,
      body: text.replace(/<[^>]*>/g, '').slice(0, 120),
      url: `/feed?thread=${feed_id}`,
    })
  } catch (e) { console.error('Reply notification failed:', e) }

  return NextResponse.json({ success: true, data })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
