import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const { searchParams } = new URL(request.url)
  const user = searchParams.get('user')
  if (!user) return NextResponse.json({ error: 'Missing user' }, { status: 400 })

  const supabase = createServerClient()
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', `email_notifs_${user}`)
    .single()

  return NextResponse.json({ enabled: data?.value !== false })
}

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const { user, enabled } = await request.json()
  if (!user) return NextResponse.json({ error: 'Missing user' }, { status: 400 })

  const supabase = createServerClient()
  await supabase.from('settings').upsert({
    key: `email_notifs_${user}`,
    value: enabled,
    updated_at: new Date().toISOString(),
  })

  return NextResponse.json({ success: true, enabled })
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
