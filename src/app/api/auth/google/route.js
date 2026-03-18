import { NextResponse } from 'next/server'

// Redirect user to Google OAuth consent screen
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
  ].join(' ')

  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&prompt=consent`

  return NextResponse.redirect(url)
}
