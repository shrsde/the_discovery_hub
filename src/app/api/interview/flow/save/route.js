import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

export async function PATCH(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const { id, workflow_graph } = await request.json()
    if (!id) return NextResponse.json({ error: 'Missing interview id' }, { status: 400 })

    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('interviews')
      .update({ workflow_graph })
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error('Flow save error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
