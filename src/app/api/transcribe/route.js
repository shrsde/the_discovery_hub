import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file) return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })

    // Validate file type
    const validTypes = ['audio/', 'video/']
    if (!validTypes.some(t => file.type.startsWith(t))) {
      return NextResponse.json({ error: 'File must be audio or video' }, { status: 400 })
    }

    const groqKey = process.env.GROQ_API_KEY
    if (!groqKey) return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 })

    // Send to Groq Whisper API
    const groqForm = new FormData()
    groqForm.append('file', file)
    groqForm.append('model', 'whisper-large-v3')
    groqForm.append('response_format', 'verbose_json')
    groqForm.append('language', 'en')

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}` },
      body: groqForm,
    })

    if (!groqRes.ok) {
      const err = await groqRes.text()
      console.error('Groq error:', err)
      return NextResponse.json({ error: `Transcription failed: ${groqRes.statusText}` }, { status: 500 })
    }

    const result = await groqRes.json()

    return NextResponse.json({
      success: true,
      transcript: result.text,
      duration: result.duration ? `${Math.round(result.duration / 60)} min` : null,
      language: result.language,
      segments: result.segments?.length || 0,
    })
  } catch (err) {
    console.error('Transcribe error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
