import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'

// Fireflies.ai GraphQL API
const FIREFLIES_API = 'https://api.fireflies.ai/graphql'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const { action, meetLink, meetingId } = await request.json()
    const ffKey = process.env.FIREFLIES_API_KEY
    if (!ffKey) return NextResponse.json({ error: 'FIREFLIES_API_KEY not configured' }, { status: 500 })

    if (action === 'join') {
      // Send Fireflies bot to join a Google Meet call
      if (!meetLink) return NextResponse.json({ error: 'Missing meetLink' }, { status: 400 })

      const res = await fetch(FIREFLIES_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ffKey}`,
        },
        body: JSON.stringify({
          query: `mutation AddToLiveMeeting($meetLink: String!) {
            addToLiveMeeting(meeting_link: $meetLink) {
              success
              message
            }
          }`,
          variables: { meetLink },
        }),
      })

      const result = await res.json()
      if (result.errors) {
        return NextResponse.json({ error: result.errors[0]?.message || 'Fireflies error' }, { status: 400 })
      }

      return NextResponse.json({ success: true, data: result.data?.addToLiveMeeting })
    }

    if (action === 'get_transcript') {
      // Get transcript for a specific meeting from Fireflies
      if (!meetingId) return NextResponse.json({ error: 'Missing meetingId' }, { status: 400 })

      const res = await fetch(FIREFLIES_API, {
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
                start_time
                end_time
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

      const result = await res.json()
      if (result.errors) {
        return NextResponse.json({ error: result.errors[0]?.message || 'Fireflies error' }, { status: 400 })
      }

      const transcript = result.data?.transcript
      if (!transcript) return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })

      // Format transcript text
      const fullText = (transcript.sentences || [])
        .map(s => `${s.speaker_name}: ${s.text}`)
        .join('\n')

      return NextResponse.json({
        success: true,
        data: {
          title: transcript.title,
          duration: transcript.duration ? `${Math.round(transcript.duration / 60)} min` : null,
          participants: transcript.participants || [],
          transcript: fullText,
          summary: transcript.summary?.overview || null,
          actionItems: transcript.summary?.action_items || null,
          keywords: transcript.summary?.keywords || [],
        },
      })
    }

    if (action === 'list_recent') {
      // List recent transcripts from Fireflies
      const res = await fetch(FIREFLIES_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ffKey}`,
        },
        body: JSON.stringify({
          query: `query RecentTranscripts {
            transcripts(limit: 10) {
              id
              title
              date
              duration
              participants
            }
          }`,
        }),
      })

      const result = await res.json()
      if (result.errors) {
        return NextResponse.json({ error: result.errors[0]?.message || 'Fireflies error' }, { status: 400 })
      }

      return NextResponse.json({ success: true, data: result.data?.transcripts || [] })
    }

    return NextResponse.json({ error: 'Invalid action. Use: join, get_transcript, list_recent' }, { status: 400 })
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
