import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'
import { generateDigest } from '@/lib/digest'

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '1')

  const { data, error } = await supabase.from('digests').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const result = await generateDigest({
    trigger_type: 'on_demand',
    requested_by: body.author || 'unknown',
    since: body.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  })

  return NextResponse.json({ success: true, ...result })
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
