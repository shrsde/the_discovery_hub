const REGION = process.env.RECALLAI_REGION || 'us-west-2'
const API_KEY = process.env.RECALLAI_API_KEY
const BASE = `https://${REGION}.recall.ai/api/v1`

async function recallFetch(method, endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Token ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Recall API ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function createBot(meetingUrl, { botName, joinAt } = {}) {
  return recallFetch('POST', '/bot', {
    meeting_url: meetingUrl,
    bot_name: botName || 'Discovery Hub',
    join_at: joinAt || undefined,
    recording_config: {
      transcript: {
        provider: { meeting_captions: {} }
      }
    },
    automatic_leave: {
      waiting_room_timeout: 600, // wait up to 10 min in waiting room
      noone_joined_timeout: 600, // wait up to 10 min if no one has joined
      everyone_left_timeout: 30,  // leave 30s after everyone leaves
    },
  })
}

export async function getBot(botId) {
  return recallFetch('GET', `/bot/${botId}`)
}

export async function getBotTranscript(botId) {
  return recallFetch('GET', `/bot/${botId}/transcript/`)
}

export async function getTranscriptById(transcriptId) {
  return recallFetch('GET', `/transcript/${transcriptId}/`)
}

export async function removeBot(botId) {
  return recallFetch('DELETE', `/bot/${botId}`)
}
