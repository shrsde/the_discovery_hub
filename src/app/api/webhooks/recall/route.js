import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import { createHmac } from 'crypto'

// Verify Recall.ai webhook signature
function verifySignature(payload, signature) {
  const secret = process.env.RECALLAI_WEBHOOK_SECRET
  if (!secret) return true // Skip verification if no secret configured
  if (!signature) return false
  const computed = createHmac('sha256', secret).update(payload).digest('hex')
  return computed === signature
}

// Recall.ai webhook — called when bot status changes or transcript completes
export async function POST(request) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-recall-signature')

    if (!verifySignature(rawBody, signature)) {
      console.error('Recall webhook: invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const body = JSON.parse(rawBody)
    const { event, data: eventData } = body

    const botId = eventData?.bot?.id
    console.log('Recall webhook received:', { event, botId })

    // Only process transcript completion events
    if (event !== 'transcript.done' && event !== 'bot.done') {
      return NextResponse.json({ ok: true, skipped: true })
    }
    if (!botId) return NextResponse.json({ ok: true, skipped: true })

    // Fetch transcript from Recall.ai
    const { getTranscriptById, getBot } = await import('@/lib/recall')
    const transcriptId = eventData?.transcript?.id

    const botInfo = await getBot(botId)

    // Get transcript — use transcript ID from webhook payload
    let transcriptData = null
    if (transcriptId) {
      try {
        transcriptData = await getTranscriptById(transcriptId)
      } catch (e) {
        console.error('Transcript fetch by ID failed:', e)
      }
    }

    if (!transcriptData) {
      console.error('No transcript found for bot:', botId)
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    // New API returns { id, data: { download_url } } — fetch the actual transcript data
    let transcriptEntries = []
    if (transcriptData.data?.download_url) {
      const dlRes = await fetch(transcriptData.data.download_url)
      transcriptEntries = await dlRes.json()
    } else if (Array.isArray(transcriptData)) {
      // Fallback: direct array response
      transcriptEntries = transcriptData
    }

    if (!transcriptEntries || transcriptEntries.length === 0) {
      console.error('Empty transcript for bot:', botId)
      return NextResponse.json({ error: 'Transcript empty' }, { status: 404 })
    }

    // Format transcript text — Recall returns array of { speaker, words: [{ text }] }
    const fullText = transcriptEntries
      .map(entry => `${entry.speaker || 'Unknown'}: ${(entry.words || []).map(w => w.text).join(' ')}`)
      .join('\n')

    const participants = [...new Set(transcriptEntries.map(e => e.speaker).filter(Boolean))]
    const duration = botInfo.meeting_metadata?.duration
      ? `${Math.round(botInfo.meeting_metadata.duration / 60)} min`
      : 'Unknown'

    // Generate AI summary with Claude
    let aiSummary = ''
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

    // Find the meeting record by recall_bot_id
    const { data: matchedMeeting } = await supabase
      .from('meetings')
      .select('id, title, meet_link, organizer')
      .eq('recall_bot_id', botId)
      .single()

    if (!matchedMeeting) {
      console.error('No meeting found for bot:', botId)
      return NextResponse.json({ error: 'Meeting not found for bot' }, { status: 404 })
    }

    // Update meeting record
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

        // Create a feed post for the completed interview
        const interviewSummary = extractedFields.biggest_signal
          || (extractedFields.pain_points?.[0]?.description)
          || aiSummary.slice(0, 200)
        const interviewAuthor = existingInterview.interviewer || participants[0] || 'Wes'

        try {
          await supabase.from('feed').insert({
            author: interviewAuthor,
            type: 'insight',
            text: `<strong>Interview completed: ${existingInterview.interviewee_name || extractedFields.interviewee_name || 'Unknown'}</strong> (${existingInterview.company || extractedFields.company || 'Unknown'})<br><br>${interviewSummary}`,
            tags: ['Wes', 'Gibb'].filter(n => n !== interviewAuthor),
            summary: `Interview auto-transcribed and processed. ${extractedFields.pain_points?.length || 0} pain points extracted.`,
            linked_interview_id: existingInterview.id,
          })
        } catch (e) { console.error('Interview feed post failed:', e) }

        // Notify both users
        try {
          const otherUser = interviewAuthor === 'Wes' ? 'Gibb' : 'Wes'
          await supabase.from('notifications').insert({
            recipient: otherUser,
            author: 'System',
            feed_id: null,
            preview: `Interview with ${existingInterview.interviewee_name || extractedFields.interviewee_name || 'Unknown'} transcribed and processed`,
          })
          const { sendPushToUser } = await import('@/lib/push')
          await sendPushToUser(otherUser, {
            title: 'Interview completed',
            body: `${existingInterview.interviewee_name || extractedFields.interviewee_name || 'Unknown'} at ${existingInterview.company || extractedFields.company || 'Unknown'} — transcript processed`,
            url: `/interviews/${existingInterview.id}`,
          })
          await sendPushToUser(interviewAuthor, {
            title: 'Interview transcribed',
            body: `Your interview with ${existingInterview.interviewee_name || extractedFields.interviewee_name || 'Unknown'} has been processed`,
            url: `/interviews/${existingInterview.id}`,
          })
        } catch (e) { console.error('Interview notification failed:', e) }
      }
    }

    // Build a rich feed post for the completed meeting
    const meetingTitle = matchedMeeting.title || 'Untitled Meeting'
    const attendeeTags = ['Wes', 'Gibb']
    const organizer = matchedMeeting.organizer || participants[0] || 'Wes'

    // Find existing "Scheduled meeting" feed post and update it into a completed post
    const { data: feedPosts } = await supabase
      .from('feed')
      .select('id, text')
      .eq('type', 'meeting')
      .is('summary', null)
      .order('created_at', { ascending: false })
      .limit(5)

    const meetTitleLower = meetingTitle.toLowerCase()
    const matchedFeed = feedPosts?.find(f =>
      f.text?.toLowerCase().includes(meetTitleLower) || meetTitleLower.includes(f.text?.toLowerCase()?.replace('scheduled meeting: ', ''))
    ) || feedPosts?.[0]

    const meetingPostText = `<strong>Meeting completed: ${meetingTitle}</strong><br><br>` +
      `<em>${duration} · ${participants.join(', ')}</em><br><br>` +
      aiSummary.slice(0, 500)

    if (matchedFeed) {
      await supabase
        .from('feed')
        .update({
          text: meetingPostText,
          summary: summaryText,
          tags: attendeeTags,
        })
        .eq('id', matchedFeed.id)
    } else {
      await supabase.from('feed').insert({
        author: organizer,
        type: 'meeting',
        text: meetingPostText,
        summary: summaryText,
        tags: attendeeTags,
      })
    }

    // Notify + push for meeting completion
    try {
      const otherUser = organizer === 'Wes' ? 'Gibb' : 'Wes'
      await supabase.from('notifications').insert({
        recipient: otherUser,
        author: organizer,
        preview: `Meeting "${meetingTitle}" transcribed — ${duration}`,
      })
      const { sendPushToUser } = await import('@/lib/push')
      await sendPushToUser(otherUser, {
        title: `Meeting transcribed: ${meetingTitle}`,
        body: `${duration} · ${participants.join(', ')}`,
        url: '/feed',
      })
      await sendPushToUser(organizer, {
        title: `Your meeting was transcribed`,
        body: `${meetingTitle} — ${duration}`,
        url: '/feed',
      })
    } catch (e) { console.error('Meeting notification failed:', e) }

    // Log the session
    try {
      await supabase.from('sessions').insert({
        author: 'System',
        action: 'meeting_transcribed',
        entity_type: 'meeting',
        entity_id: matchedMeeting.id,
        summary: `Auto-transcribed: ${meetingTitle} (${duration}, ${participants.length} participants)`,
      })
    } catch (e) { console.error('Session log failed:', e) }

    console.log('Recall webhook processed successfully:', meetingTitle)
    return NextResponse.json({ success: true, title: meetingTitle })
  } catch (err) {
    console.error('Recall webhook error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Recall.ai needs GET for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'discovery-hub-recall-webhook' })
}
