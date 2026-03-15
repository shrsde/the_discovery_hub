import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest, logSession } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const interviewId = formData.get('interview_id')
    const uploadedBy = formData.get('uploaded_by') || 'Wes'

    if (!file || !interviewId) {
      return NextResponse.json({ error: 'Missing file or interview_id' }, { status: 400 })
    }

    const supabase = createServerClient()
    const ext = file.name.split('.').pop()
    const filename = `${interviewId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from('interview-attachments')
      .upload(filename, buffer, { contentType: file.type, upsert: false })

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 })

    const { data: urlData } = supabase.storage
      .from('interview-attachments')
      .getPublicUrl(filename)

    // Try to parse text content for searchability
    let parsedText = null
    let summary = null

    const isTextParseable = file.type.includes('text') || file.type.includes('csv') ||
      file.name.endsWith('.txt') || file.name.endsWith('.csv') || file.name.endsWith('.md')

    if (isTextParseable && buffer.length < 500000) {
      parsedText = buffer.toString('utf-8').slice(0, 10000)
      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: `Summarize this document in 2-3 sentences for a CPG discovery research database:\n\n${parsedText.slice(0, 5000)}` }],
        })
        summary = res.content[0].text
      } catch (e) { console.error('Summary generation failed:', e) }
    }

    const record = {
      interview_id: interviewId,
      uploaded_by: uploadedBy,
      file_url: urlData.publicUrl,
      file_name: file.name,
      file_type: file.type,
      file_size: buffer.length,
      parsed_text: parsedText,
      summary,
    }

    const { data, error } = await supabase.from('attachments').insert(record).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logSession(supabase, {
      author: uploadedBy,
      action: 'uploaded_attachment',
      entity_type: 'attachment',
      entity_id: data.id,
      summary: `Attached ${file.name} to interview`,
    })

    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error('Attachment upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const interviewId = searchParams.get('interview_id')

  let query = supabase.from('attachments').select('*').order('created_at', { ascending: false })
  if (interviewId) query = query.eq('interview_id', interviewId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function DELETE(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const supabase = createServerClient()
  const { error } = await supabase.from('attachments').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
