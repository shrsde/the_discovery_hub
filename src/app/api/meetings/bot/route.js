import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const { action, meetingId } = await request.json()
    if (!process.env.RECALLAI_API_KEY) return NextResponse.json({ error: 'RECALLAI_API_KEY not configured' }, { status: 500 })

    const { getBot, getBotTranscript, removeBot } = await import('@/lib/recall')

    // Look up recall_bot_id from meeting record
    let botId = null
    if (meetingId) {
      const supabase = createServerClient()
      const { data: meeting } = await supabase
        .from('meetings')
        .select('recall_bot_id')
        .eq('id', meetingId)
        .single()
      botId = meeting?.recall_bot_id
    }

    if (!botId) return NextResponse.json({ error: 'No Recall bot found for this meeting' }, { status: 404 })

    if (action === 'status') {
      // Check bot status — is it in the meeting, recording, done, etc.
      const bot = await getBot(botId)
      return NextResponse.json({
        success: true,
        data: {
          id: bot.id,
          status: bot.status?.code || bot.status,
          meetingUrl: bot.meeting_url,
          joinedAt: bot.join_at,
          metadata: bot.meeting_metadata || null,
        },
      })
    }

    if (action === 'transcript') {
      // Fetch transcript for the bot's recording
      const transcript = await getBotTranscript(botId)
      const fullText = (transcript || [])
        .map(entry => `${entry.speaker || 'Unknown'}: ${(entry.words || []).map(w => w.text).join(' ')}`)
        .join('\n')

      return NextResponse.json({
        success: true,
        data: {
          transcript: fullText,
          speakers: [...new Set((transcript || []).map(e => e.speaker).filter(Boolean))],
        },
      })
    }

    if (action === 'remove') {
      // Remove bot from the call
      await removeBot(botId)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action. Use: status, transcript, remove' }, { status: 400 })
  } catch (err) {
    console.error('Meeting bot error:', err)
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
