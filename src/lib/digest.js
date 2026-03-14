import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from './supabase'

export async function generateDigest({ trigger_type, requested_by, since }) {
  const supabase = createServerClient()
  const sinceTs = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [interviews, feedItems, syncItems, sessionLog] = await Promise.all([
    supabase.from('interviews').select('*').gte('updated_at', sinceTs).order('updated_at', { ascending: false }),
    supabase.from('feed').select('*').gte('created_at', sinceTs).order('created_at', { ascending: false }),
    supabase.from('syncs').select('*').gte('updated_at', sinceTs).order('updated_at', { ascending: false }),
    supabase.from('sessions').select('*').gte('created_at', sinceTs).order('created_at', { ascending: false }),
  ])

  const changes = {
    interviews: interviews.data || [],
    feed: feedItems.data || [],
    syncs: syncItems.data || [],
    sessions: sessionLog.data || [],
  }

  const total = changes.interviews.length + changes.feed.length + changes.syncs.length
  if (total === 0) {
    return { summary: 'No new activity since last digest.', details: changes }
  }

  const prompt = `You are summarizing recent activity in a CPG discovery research project run by two founders, Wes (based in Vancouver, consumer/field marketing background) and Gibb (Kellogg MBA, sales/distribution background). They are interviewing CPG insiders to find high-value problems for AI-powered solutions.

Changes since ${sinceTs}:

INTERVIEWS (${changes.interviews.length}):
${changes.interviews.map(i => `- ${i.company} / ${i.interviewee_name} (by ${i.interviewer}, ${i.date}) — Confidence: ${i.confidence}/5, Score: ${i.score_total}/30
  Signal: ${i.biggest_signal || 'none'}
  Pains: ${(i.pain_points || []).filter(p => p.description).map(p => p.description).join('; ') || 'none'}`).join('\n')}

FEED (${changes.feed.length}):
${changes.feed.map(f => `- [${f.type}] ${f.author}: ${f.text}`).join('\n')}

SYNCS (${changes.syncs.length}):
${changes.syncs.map(s => `- [${s.type}|${s.status}] ${s.author}: ${s.title}\n  Takeaways: ${s.key_takeaways || 'none'}`).join('\n')}

Generate a tight digest:
1. HEADLINE — one sentence, most important development
2. KEY CHANGES — 2-4 bullets
3. PATTERNS — convergence or divergence across data
4. LOOK AT FIRST — what the other person should read
5. OPEN THREADS — unresolved items

Keep it scan-friendly. This is for someone checking in after a few hours away.`

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })
    const summary = msg.content[0]?.text || 'Digest generation failed.'

    const { data } = await supabase.from('digests').insert({
      trigger_type, requested_by, since_timestamp: sinceTs, summary, details: changes,
    }).select().single()

    return { summary, details: changes, digest_id: data?.id }
  } catch (err) {
    console.error('Digest error:', err)
    const fallback = `${total} changes: ${changes.interviews.length} interviews, ${changes.feed.length} feed, ${changes.syncs.length} syncs.`
    await supabase.from('digests').insert({
      trigger_type, requested_by, since_timestamp: sinceTs, summary: fallback, details: changes,
    })
    return { summary: fallback, details: changes }
  }
}
