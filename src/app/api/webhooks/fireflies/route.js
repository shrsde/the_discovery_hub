import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

// Fireflies webhook — called when transcription is complete
// No auth check — Fireflies calls this directly
export async function POST(request) {
  try {
    const body = await request.json()
    const { meetingId, eventType } = body

    console.log('Fireflies webhook received:', { meetingId, eventType })

    if (eventType !== 'Transcription completed' || !meetingId) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    // Fetch the full transcript from Fireflies
    const ffKey = process.env.FIREFLIES_API_KEY
    if (!ffKey) return NextResponse.json({ error: 'No Fireflies key' }, { status: 500 })

    const ffRes = await fetch('https://api.fireflies.ai/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ffKey}`,
      },
      body: JSON.stringify({
        query: `query Transcript($id: String!) {
          transcript(id: $id) {
            id
            title
            duration
            participants
            sentences {
              text
              speaker_name
            }
            summary {
              overview
              action_items
              keywords
            }
          }
        }`,
        variables: { id: meetingId },
      }),
    })

    const ffData = await ffRes.json()
    const transcript = ffData.data?.transcript

    if (!transcript) {
      console.error('No transcript found for meeting:', meetingId)
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    // Format transcript text
    const fullText = (transcript.sentences || [])
      .map(s => `${s.speaker_name}: ${s.text}`)
      .join('\n')

    const participants = [...new Set((transcript.participants || []).filter(Boolean))]
    const duration = transcript.duration ? `${Math.round(transcript.duration / 60)} min` : 'Unknown'

    // Generate AI summary with Claude
    let aiSummary = transcript.summary?.overview || ''
    if (fullText && process.env.ANTHROPIC_API_KEY) {
      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          system: 'You are summarizing a meeting between co-founders doing CPG industry discovery research. Extract: key decisions, action items (with owner: Wes or Gibb), insights, and next steps. Be concise and actionable.',
          messages: [{ role: 'user', content: `Meeting transcript:\n\n${fullText.slice(0, 15000)}` }],
        })
        aiSummary = res.content[0].text
      } catch (e) {
        console.error('Claude summary failed:', e)
      }
    }

    const supabase = createServerClient()

    // Find the meeting record by title match
    const { data: meetings } = await supabase
      .from('meetings')
      .select('id')
      .eq('status', 'scheduled')
      .order('created_at', { ascending: false })
      .limit(5)

    // Update the most recent scheduled meeting
    if (meetings && meetings.length > 0) {
      await supabase
        .from('meetings')
        .update({
          status: 'completed',
          transcript: fullText,
          parsed_summary: aiSummary,
        })
        .eq('id', meetings[0].id)
    }

    // Find the matching feed post and update it
    const summaryText = `Participants: ${participants.join(', ')} | Duration: ${duration}\n\n${aiSummary}`

    const { data: feedPosts } = await supabase
      .from('feed')
      .select('id, text')
      .eq('type', 'meeting')
      .is('summary', null)
      .order('created_at', { ascending: false })
      .limit(5)

    if (feedPosts && feedPosts.length > 0) {
      await supabase
        .from('feed')
        .update({ summary: summaryText })
        .eq('id', feedPosts[0].id)
    } else {
      // No existing feed post — create one
      await supabase.from('feed').insert({
        author: participants[0] || 'Wes',
        type: 'meeting',
        text: `Meeting completed: ${transcript.title || 'Untitled'}`,
        summary: summaryText,
        tags: participants.filter(p => ['Wes', 'Gibb'].includes(p)),
      })
    }

    // Log the session
    await supabase.from('sessions').insert({
      author: 'System',
      action: 'meeting_transcribed',
      entity_type: 'meeting',
      summary: `Auto-transcribed: ${transcript.title || 'Meeting'} (${duration}, ${participants.length} participants)`,
    }).catch(() => {})

    console.log('Fireflies webhook processed successfully:', transcript.title)
    return NextResponse.json({ success: true, title: transcript.title })
  } catch (err) {
    console.error('Fireflies webhook error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Fireflies needs GET for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'discovery-hub-fireflies-webhook' })
}
