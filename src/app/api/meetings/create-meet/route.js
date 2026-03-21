import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

async function getGoogleTokens(supabase) {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'google_tokens')
    .single()

  if (!data?.value) return null
  return data.value
}

async function refreshAccessToken(supabase, tokens) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })

  const newTokens = await res.json()
  if (newTokens.error) throw new Error(newTokens.error_description || 'Token refresh failed')

  const updated = {
    access_token: newTokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (newTokens.expires_in * 1000),
  }

  await supabase.from('settings').update({
    value: updated,
    updated_at: new Date().toISOString(),
  }).eq('key', 'google_tokens')

  return updated
}

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const { title } = await request.json()
    if (!title) return NextResponse.json({ error: 'Missing title' }, { status: 400 })

    const supabase = createServerClient()
    let tokens = await getGoogleTokens(supabase)

    if (!tokens) {
      return NextResponse.json({
        error: 'Google Calendar not connected. Visit /api/auth/google to authorize.',
        authUrl: `${process.env.GOOGLE_REDIRECT_URI?.replace('/callback', '') || '/api/auth/google'}`,
      }, { status: 401 })
    }

    // Refresh if expired
    if (Date.now() > tokens.expires_at - 60000) {
      tokens = await refreshAccessToken(supabase, tokens)
    }

    // Create a calendar event with Google Meet
    const now = new Date()
    const start = now.toISOString()
    const end = new Date(now.getTime() + 60 * 60 * 1000).toISOString() // 1 hour

    const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify({
        summary: title,
        start: { dateTime: start },
        end: { dateTime: end },
        attendees: [
          { email: 'wes@shrsde.com' },
          { email: 'gibbanella1@gmail.com' },
          { email: process.env.FIREFLIES_BOT_EMAIL || 'fred@fireflies.ai' },
        ],
        guestsCanModify: true,
        conferenceData: {
          createRequest: {
            requestId: `dh-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
    })

    const event = await calRes.json()

    if (event.error) {
      console.error('Google Calendar error:', event.error)
      return NextResponse.json({ error: event.error.message }, { status: 400 })
    }

    const meetLink = event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri

    if (!meetLink) {
      return NextResponse.json({ error: 'No Meet link generated' }, { status: 500 })
    }

    return NextResponse.json({ success: true, meetLink, eventId: event.id })
  } catch (err) {
    console.error('Create Meet error:', err)
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
