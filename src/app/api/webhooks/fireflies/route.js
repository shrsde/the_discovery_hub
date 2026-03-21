import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import { createHmac } from 'crypto'

// Verify Fireflies webhook signature
function verifySignature(payload, signature) {
  const secret = process.env.FIREFLIES_WEBHOOK_SECRET
  if (!secret) return true // Skip verification if no secret configured
  if (!signature) return false
  const computed = createHmac('sha256', secret).update(payload).digest('hex')
  return computed === signature
}

// Fireflies webhook — called when transcription is complete
export async function POST(request) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-hub-signature')

    if (!verifySignature(rawBody, signature)) {
      console.error('Fireflies webhook: invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const body = JSON.parse(rawBody)
    const { meetingId, eventType } = body

    console.log('Fireflies webhook received:', { meetingId, eventType })

    if (eventType !== 'Transcription completed' || !meetingId) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    // Fetch the full transcript from Fireflies
    const ffKey = process.env.FIREFLIES_API_KEY
    if (!ffKey) return NextResponse.json({ error: 'No Fireflies key' }, { status: 500 })

    const ffRes = await fetch('https://api.fireflies.ai/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ffKey}`,
      },
      body: JSON.stringify({
        query: `query Transcript($id: String!) {
          transcript(id: $id) {
            id
            title
            duration
            participants
            sentences {
              text
              speaker_name
            }
            summary {
              overview
              action_items
              keywords
            }
          }
        }`,
        variables: { id: meetingId },
      }),
    })

    const ffData = await ffRes.json()
    const transcript = ffData.data?.transcript

    if (!transcript) {
      console.error('No transcript found for meeting:', meetingId)
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    // Format transcript text
    const fullText = (transcript.sentences || [])
      .map(s => `${s.speaker_name}: ${s.text}`)
      .join('\n')

    const participants = [...new Set((transcript.participants || []).filter(Boolean))]
    const duration = transcript.duration ? `${Math.round(transcript.duration / 60)} min` : 'Unknown'

    // Generate AI summary with Claude
    let aiSummary = transcript.summary?.overview || ''
    if (fullText && process.env.ANTHROPIC_API_KEY) {
      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          system: 'You are summarizing a meeting between co-founders doing CPG industry discovery research. Extract: key decisions, action items (with owner: Wes or Gibb), insights, and next steps. Be concise and actionable.',
          messages: [{ role: 'user', content: `Meeting transcript:\n\n${fullText.slice(0, 15000)}` }],
        })
        aiSummary = res.content[0].text
      } catch (e) {
        console.error('Claude summary failed:', e)
      }
    }

    const supabase = createServerClient()
    const summaryText = `Participants: ${participants.join(', ')} | Duration: ${duration}\n\n${aiSummary}`

    // Find the meeting record — try matching by title, then fall back to most recent
    const { data: allMeetings } = await supabase
      .from('meetings')
      .select('id, title, meet_link')
      .eq('status', 'scheduled')
      .order('created_at', { ascending: false })
      .limit(10)

    const meetTitle = (transcript.title || '').toLowerCase()
    const matchedMeeting = allMeetings?.find(m =>
      meetTitle.includes(m.title?.toLowerCase()) || m.title?.toLowerCase().includes(meetTitle)
    ) || allMeetings?.[0]

    if (matchedMeeting) {
      await supabase
        .from('meetings')
        .update({
          status: 'completed',
          transcript: fullText,
          parsed_summary: aiSummary,
        })
        .eq('id', matchedMeeting.id)

      // Find linked interview by meet_link and update with transcript summary + extracted data
      if (matchedMeeting.meet_link) {
        const { data: interviews } = await supabase
          .from('interviews')
          .select('*')
          .eq('meet_link', matchedMeeting.meet_link)
          .in('status', ['scheduled', 'in_progress'])
          .limit(1)

        if (interviews && interviews.length > 0) {
          const existingInterview = interviews[0]
          let extractedFields = {}

          // Extract structured interview data from transcript using Claude
          if (fullText && process.env.ANTHROPIC_API_KEY) {
            try {
              const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
              const extractionRes = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4000,
                system: `You are an expert at extracting structured interview data from raw transcripts. You will receive a transcript of a CPG industry discovery interview.

Extract as much information as possible and return a JSON object with these fields. Use null for any field you cannot determine from the transcript. Be thorough — capture verbatim quotes exactly as spoken.

Return ONLY valid JSON, no markdown code blocks, no explanation:

{
  "interviewee_name": "string or null",
  "company": "string or null",
  "role": "string or null",
  "department": "string or null",
  "company_size": "string or null — revenue, employee count, etc.",
  "channels": ["array of: Retail, Foodservice, DTC, Club, Convenience, E-commerce"],
  "distributors": "string or null — e.g. UNFI, KeHE, Sysco",
  "connection_source": "string or null — how the interview was arranged",
  "workflow_steps": "string or null — describe their primary workflow",
  "systems_tools": "string or null — software/tools they use",
  "data_sources": "string or null — where they get data",
  "handoffs": "string or null — who passes work to whom",
  "time_spent": "string or null — how much time on key tasks",
  "workarounds": "string or null — manual processes, hacks",
  "pain_points": [
    {
      "description": "verbatim or close to verbatim pain statement",
      "category": "Overhead Savings | Revenue Adder | Risk Reduction | Speed/Efficiency",
      "dollar_impact": "string or null",
      "frequency": "Daily | Weekly | Monthly | Quarterly | Annually | Ad-hoc",
      "who_feels": "string or null — which team/role",
      "current_solution": "string or null — how they handle it now"
    }
  ],
  "tools_evaluated": "string or null — tools they've tried",
  "why_failed": "string or null — why those tools didn't work",
  "current_spend": "string or null — what they spend on solutions",
  "budget_authority": "string or null — who controls budget",
  "willingness_to_pay": "string or null — would they pay, how much",
  "integration_reqs": "string or null — what it needs to integrate with",
  "verbatim_quotes": "string — the most striking direct quotes, separated by newlines",
  "observations": "string or null — notable things about their workflow/attitude",
  "surprises": "string or null — anything unexpected",
  "follow_ups": "string or null — suggested follow-up actions",
  "biggest_signal": "string or null — the clearest opportunity signal from this interview",
  "intel_vs_judgement": "number 0-100 — how much of their work is intelligence (data gathering/processing) vs judgement (decisions requiring expertise). Higher = more intelligence-based",
  "outsourced_vs_insourced": "Fully outsourced | Mostly outsourced | Split | Mostly insourced | Fully insourced | null",
  "autopilot_vs_copilot": "Autopilot | Copilot | Hybrid | Unclear | null",
  "confidence": "number 1-5 — how confident are you in the quality/depth of this interview data",
  "notes": "string or null — any additional context worth capturing"
}

Guidelines:
- Extract up to 3 pain points, prioritizing those with clear dollar impact or strong emotional language
- For verbatim_quotes, capture the most vivid/specific statements — "I wish..." and "We spend X hours..." type statements
- For intel_vs_judgement, estimate based on how much of their described work is routine data processing vs. requiring human expertise
- For confidence, rate based on how much useful data the transcript contains (5 = very detailed, 1 = sparse)
- If the transcript is a conversation, extract the interviewee's statements, not the interviewer's`,
                messages: [
                  { role: 'user', content: `Here is the interview transcript:\n\n${fullText}` }
                ],
              })

              const extractedText = extractionRes.content[0].text
              try {
                const cleaned = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
                extractedFields = JSON.parse(cleaned)
              } catch (parseErr) {
                console.error('Failed to parse Claude extraction response:', parseErr)
              }
            } catch (extractErr) {
              console.error('Claude interview extraction failed:', extractErr)
            }
          }

          // Build update object: only fill in fields that are currently null/empty on the existing interview
          const updateData = { status: 'completed' }

          // Add AI summary to notes
          const newNotes = `## Auto-Transcribed Meeting Summary\n\n${summaryText}`
          updateData.notes = existingInterview.notes
            ? `${existingInterview.notes}\n\n${newNotes}`
            : newNotes

          // Map extracted fields to interview columns, only setting those that are currently null/empty
          const fieldMap = [
            'interviewee_name', 'company', 'role', 'department', 'company_size',
            'channels', 'distributors', 'connection_source', 'workflow_steps',
            'systems_tools', 'data_sources', 'handoffs', 'time_spent', 'workarounds',
            'pain_points', 'tools_evaluated', 'why_failed', 'current_spend',
            'budget_authority', 'willingness_to_pay', 'integration_reqs',
            'verbatim_quotes', 'observations', 'surprises', 'follow_ups',
            'biggest_signal', 'intel_vs_judgement', 'outsourced_vs_insourced',
            'autopilot_vs_copilot', 'confidence',
          ]

          for (const field of fieldMap) {
            const existingVal = existingInterview[field]
            const extractedVal = extractedFields[field]
            // Only fill in if existing value is null/undefined/empty and extracted value is present
            const isEmpty = existingVal === null || existingVal === undefined || existingVal === '' ||
              (Array.isArray(existingVal) && existingVal.length === 0)
            if (isEmpty && extractedVal !== null && extractedVal !== undefined) {
              updateData[field] = extractedVal
            }
          }

          await supabase
            .from('interviews')
            .update(updateData)
            .eq('id', existingInterview.id)

          console.log('Linked interview updated with extracted data:', existingInterview.id)
        }
      }
    }

    // Find the matching feed post and update it
    const { data: feedPosts } = await supabase
      .from('feed')
      .select('id, text')
      .eq('type', 'meeting')
      .is('summary', null)
      .order('created_at', { ascending: false })
      .limit(5)

    // Try to match feed post by title
    const matchedFeed = feedPosts?.find(f =>
      f.text?.toLowerCase().includes(meetTitle) || meetTitle.includes(f.text?.toLowerCase()?.replace('scheduled meeting: ', ''))
    ) || feedPosts?.[0]

    if (matchedFeed) {
      await supabase
        .from('feed')
        .update({ summary: summaryText })
        .eq('id', matchedFeed.id)
    } else {
      // No existing feed post — create one
      await supabase.from('feed').insert({
        author: participants[0] || 'Wes',
        type: 'meeting',
        text: `Meeting completed: ${transcript.title || 'Untitled'}`,
        summary: summaryText,
        tags: participants.filter(p => ['Wes', 'Gibb'].includes(p)),
      })
    }

    // Log the session
    await supabase.from('sessions').insert({
      author: 'System',
      action: 'meeting_transcribed',
      entity_type: 'meeting',
      summary: `Auto-transcribed: ${transcript.title || 'Meeting'} (${duration}, ${participants.length} participants)`,
    }).catch(() => {})

    console.log('Fireflies webhook processed successfully:', transcript.title)
    return NextResponse.json({ success: true, title: transcript.title })
  } catch (err) {
    console.error('Fireflies webhook error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Fireflies needs GET for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'discovery-hub-fireflies-webhook' })
}
