import { NextResponse } from 'next/server'

export function authenticateRequest(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return { authenticated: true, preflight: true }
  }

  const authHeader = request.headers.get('authorization')
  const apiKey = process.env.DISCOVERY_HUB_API_KEY

  if (!apiKey) return { authenticated: true } // dev mode

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      response: NextResponse.json({ error: 'Missing authorization header. Use: Authorization: Bearer <key>' }, { status: 401 })
    }
  }

  if (authHeader.replace('Bearer ', '') !== apiKey) {
    return {
      authenticated: false,
      response: NextResponse.json({ error: 'Invalid API key' }, { status: 403 })
    }
  }

  return { authenticated: true }
}

export async function logSession(supabase, { author, action, entity_type, entity_id, summary }) {
  try {
    await supabase.from('sessions').insert({ author, action, entity_type, entity_id, summary })
  } catch (e) {
    console.error('Session log error:', e)
  }
}
