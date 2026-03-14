import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const supabase = createServerClient()
    const ext = file.name.split('.').pop()
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    // Determine media type
    let mediaType = 'document'
    if (file.type.startsWith('image/')) mediaType = 'image'
    else if (file.type.startsWith('video/')) mediaType = 'video'

    const buffer = Buffer.from(await file.arrayBuffer())

    const { data, error } = await supabase.storage
      .from('feed-media')
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: urlData } = supabase.storage
      .from('feed-media')
      .getPublicUrl(filename)

    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      mediaType,
      mediaName: file.name,
    })
  } catch (err) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
