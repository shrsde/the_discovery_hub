import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

// Google OAuth callback — exchange code for tokens and store them
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL('/?google_auth=error', request.url))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?google_auth=missing_code', request.url))
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    const tokens = await tokenRes.json()

    if (tokens.error) {
      console.error('Google token error:', tokens)
      return NextResponse.redirect(new URL('/?google_auth=token_error', request.url))
    }

    // Store tokens in Supabase settings table
    const supabase = createServerClient()

    await supabase.from('settings').upsert({
      key: 'google_tokens',
      value: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in * 1000),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })

    // Redirect back to the app
    const frontendUrl = process.env.FRONTEND_URL || 'https://discovery-hub-fe.vercel.app'
    return NextResponse.redirect(`${frontendUrl}/?google_auth=success`)
  } catch (err) {
    console.error('Google callback error:', err)
    return NextResponse.redirect(new URL('/?google_auth=error', request.url))
  }
}
