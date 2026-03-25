import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest, logSession } from '@/lib/auth'

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (id) {
    // Single project with all items
    const { data: project, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: items } = await supabase
      .from('project_items')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false })

    // Hydrate linked items by type
    const feedIds = (items || []).filter(i => i.item_type === 'feed' && i.item_id).map(i => i.item_id)
    const interviewIds = (items || []).filter(i => i.item_type === 'interview' && i.item_id).map(i => i.item_id)
    const meetingIds = (items || []).filter(i => i.item_type === 'meeting' && i.item_id).map(i => i.item_id)

    const [feedData, interviewData, meetingData] = await Promise.all([
      feedIds.length > 0
        ? supabase.from('feed').select('id, text, author, type, created_at, thread_tag, attachments').in('id', feedIds).then(r => r.data || [])
        : [],
      interviewIds.length > 0
        ? supabase.from('interviews').select('id, interviewee_name, company, role, status, biggest_signal').in('id', interviewIds).then(r => r.data || [])
        : [],
      meetingIds.length > 0
        ? supabase.from('meetings').select('id, title, status, scheduled_at, parsed_summary, meet_link').in('id', meetingIds).then(r => r.data || [])
        : [],
    ])

    const sourceMap = {}
    for (const f of feedData) sourceMap[`feed:${f.id}`] = f
    for (const i of interviewData) sourceMap[`interview:${i.id}`] = i
    for (const m of meetingData) sourceMap[`meeting:${m.id}`] = m

    const hydratedItems = (items || []).map(item => ({
      ...item,
      source: item.item_id ? sourceMap[`${item.item_type}:${item.item_id}`] || null : null,
    }))

    return NextResponse.json({ data: { ...project, items: hydratedItems } })
  }

  // List all projects with item counts
  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Get item counts per project
  const { data: counts } = await supabase
    .from('project_items')
    .select('project_id')

  const countMap = {}
  for (const c of (counts || [])) {
    countMap[c.project_id] = (countMap[c.project_id] || 0) + 1
  }

  const projectsWithCounts = (projects || []).map(p => ({
    ...p,
    item_count: countMap[p.id] || 0,
  }))

  return NextResponse.json({ data: projectsWithCounts })
}

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (body.action === 'create_project') {
    const { data, error } = await supabase.from('projects').insert({
      title: body.title,
      description: body.description || null,
      summary: body.summary || null,
      public_url: body.public_url || null,
      icon: body.icon || '◈',
      color: body.color || 'blue',
      created_by: body.created_by || 'Wes',
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logSession(supabase, {
      author: body.created_by || 'Wes',
      action: 'created_project',
      entity_type: 'project',
      entity_id: data.id,
      summary: `Project: ${body.title}`,
    })

    return NextResponse.json({ success: true, data })
  }

  if (body.action === 'add_item') {
    const record = {
      project_id: body.project_id,
      item_type: body.item_type,
      item_id: body.item_id || null,
      title: body.title || null,
      url: body.url || null,
      notes: body.notes || null,
      added_by: body.added_by || 'Wes',
    }

    const { data, error } = await supabase.from('project_items').insert(record).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Update project's updated_at
    await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', body.project_id)

    return NextResponse.json({ success: true, data })
  }

  return NextResponse.json({ error: 'Invalid action. Use: create_project, add_item' }, { status: 400 })
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
  if (body.summary !== undefined) updates.summary = body.summary
  if (body.public_url !== undefined) updates.public_url = body.public_url
  if (body.icon !== undefined) updates.icon = body.icon
  if (body.color !== undefined) updates.color = body.color
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase.from('projects').update(updates).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (body.type === 'project') {
    const { error } = await supabase.from('projects').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else if (body.type === 'item') {
    const { error } = await supabase.from('project_items').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    return NextResponse.json({ error: 'Missing type: project or item' }, { status: 400 })
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
