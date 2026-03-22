import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest, logSession } from '@/lib/auth'

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') // 'entries', 'folders', or null (both)
  const folderId = searchParams.get('folder_id')

  if (type === 'folders') {
    const { data, error } = await supabase
      .from('index_folders')
      .select('*')
      .order('name', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  }

  let query = supabase.from('index_entries').select('*').order('pinned', { ascending: false }).order('updated_at', { ascending: false })
  if (folderId) query = query.eq('folder_id', folderId)

  const { data: entries, error: entriesErr } = await query
  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 400 })

  if (type === 'entries') return NextResponse.json({ data: entries })

  const { data: folders } = await supabase.from('index_folders').select('*').order('name')
  return NextResponse.json({ entries, folders: folders || [] })
}

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  // Create folder
  if (body.action === 'create_folder') {
    const { data, error } = await supabase.from('index_folders').insert({
      name: body.name,
      description: body.description || null,
      icon: body.icon || '◈',
      color: body.color || 'blue',
      parent_id: body.parent_id || null,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, data })
  }

  // Create entry
  const record = {
    folder_id: body.folder_id || null,
    title: body.title,
    body: body.body || null,
    source_type: body.source_type || 'manual',
    source_id: body.source_id || null,
    tags: body.tags || [],
    author: body.author || 'Wes',
  }

  const { data, error } = await supabase.from('index_entries').insert(record).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logSession(supabase, {
    author: record.author,
    action: 'indexed_entry',
    entity_type: 'index',
    entity_id: data.id,
    summary: `Indexed: ${record.title?.slice(0, 80)}`,
  })

  return NextResponse.json({ success: true, data })
}

export async function PATCH(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Update folder
  if (body.type === 'folder') {
    const updates = {}
    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.icon !== undefined) updates.icon = body.icon
    if (body.color !== undefined) updates.color = body.color
    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabase.from('index_folders').update(updates).eq('id', body.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, data })
  }

  // Update entry
  const updates = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.body !== undefined) updates.body = body.body
  if (body.folder_id !== undefined) updates.folder_id = body.folder_id
  if (body.tags !== undefined) updates.tags = body.tags
  if (body.pinned !== undefined) updates.pinned = body.pinned
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase.from('index_entries').update(updates).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (body.type === 'folder') {
    // Move entries to uncategorized before deleting folder
    await supabase.from('index_entries').update({ folder_id: null }).eq('folder_id', body.id)
    const { error } = await supabase.from('index_folders').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    const { error } = await supabase.from('index_entries').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

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
