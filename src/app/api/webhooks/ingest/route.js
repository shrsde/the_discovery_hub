import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logSession } from '@/lib/auth'

const PHONE_MAP = {
  // Add phone numbers here: '+1XXXXXXXXXX': 'Wes'
}

export async function POST(request) {
  // Validate webhook secret
  const authHeader = request.headers.get('authorization')
  const secret = process.env.INGEST_WEBHOOK_SECRET
  if (!secret || !authHeader || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    let { author, text, type, tags, from, media_url, source } = body

    if (!author && from) {
      author = PHONE_MAP[from]
    }
    if (!author) {
      return NextResponse.json({ error: 'Missing author (provide author or from)' }, { status: 400 })
    }
    if (!text) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 })
    }

    // Optionally classify type via Claude if not provided
    if (!type && process.env.ANTHROPIC_API_KEY) {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic()
        const msg = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 20,
          messages: [{ role: 'user', content: `Classify this feed post into exactly one category: insight, hypothesis, challenge, action, meeting, quote. Reply with only the category word.\n\n"${text.slice(0, 300)}"` }],
        })
        const classified = msg.content[0].text.trim().toLowerCase()
        if (['insight', 'hypothesis', 'challenge', 'action', 'meeting', 'quote'].includes(classified)) {
          type = classified
        }
      } catch (e) {
        console.error('Classification failed, defaulting to insight:', e.message)
      }
    }
    type = type || 'insight'

    const supabase = createServerClient()

    const record = {
      author,
      type,
      text,
      tags: tags || [],
      media_url: media_url || null,
      media_type: null,
      media_name: null,
      summary: source ? `[via ${source}]` : null,
    }

    const { data, error } = await supabase.from('feed').insert(record).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Create in-app notification for the other user
    const otherUser = author === 'Wes' ? 'Gibb' : 'Wes'
    try {
      await supabase.from('notifications').insert({
        recipient: otherUser,
        author,
        feed_id: data.id,
        preview: text.replace(/<[^>]*>/g, '').slice(0, 100),
      })
    } catch (e) { console.error('Notification insert failed:', e) }

    // Send push notification
    try {
      const { sendPushToUser } = await import('@/lib/push')
      await sendPushToUser(otherUser, {
        title: `${author} posted a ${type}`,
        body: text.replace(/<[^>]*>/g, '').slice(0, 120),
        url: '/feed',
      })
    } catch (e) { console.error('Push failed:', e) }

    await logSession(supabase, {
      author,
      action: 'webhook_ingest',
      entity_type: 'feed',
      entity_id: data.id,
      summary: `[${type}] via ${source || 'webhook'}: ${text.slice(0, 80)}`,
    })

    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error('Ingest webhook error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
