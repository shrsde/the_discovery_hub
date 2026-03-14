import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const since = searchParams.get('since')
  const limit = parseInt(searchParams.get('limit') || '50')

  let query = supabase.from('sessions').select('*').order('created_at', { ascending: false }).limit(limit)
  if (since) query = query.gte('created_at', since)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
