import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest, logSession } from '@/lib/auth'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  const record = {
    title: body.title,
    description: body.description || null,
    status: body.status || 'todo',
    assignee: body.assignee || null,
    due_date: body.due_date || body.dueDate || null,
    priority: body.priority || 'medium',
    source_type: body.source_type || body.sourceType || 'manual',
    source_id: body.source_id || body.sourceId || null,
    position: body.position || 0,
    created_by: body.created_by || body.createdBy || 'Wes',
  }

  const { data, error } = await supabase.from('tasks').insert(record).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logSession(supabase, {
    author: record.created_by,
    action: 'created_task',
    entity_type: 'task',
    entity_id: data.id,
    summary: `Task: ${record.title}`,
  })

  return NextResponse.json({ success: true, data })
}

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function PATCH(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.status !== undefined) updates.status = body.status
  if (body.assignee !== undefined) updates.assignee = body.assignee
  if (body.due_date !== undefined) updates.due_date = body.due_date
  if (body.priority !== undefined) updates.priority = body.priority
  if (body.position !== undefined) updates.position = body.position

  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const supabase = createServerClient()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
