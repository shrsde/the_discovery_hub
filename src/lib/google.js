import { createServerClient } from '@/lib/supabase'

export async function getGoogleTokens(supabase) {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'google_tokens')
    .single()
  if (!data?.value) return null
  return data.value
}

export async function refreshAccessToken(supabase, tokens) {
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

export async function getValidAccessToken(supabase) {
  let tokens = await getGoogleTokens(supabase)
  if (!tokens) throw new Error('Google not connected. Visit /api/auth/google to authorize.')
  if (Date.now() > tokens.expires_at - 60000) {
    tokens = await refreshAccessToken(supabase, tokens)
  }
  return tokens.access_token
}
