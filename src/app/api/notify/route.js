import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

const USER_EMAILS = {
  'Wes': 'wes@shrsde.com',
  'Gibb': 'gibbanella1@gmail.com',
}

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const { tags, author, text, type } = await request.json()

    if (!tags || tags.length === 0) return NextResponse.json({ success: true, sent: 0 })

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) return NextResponse.json({ success: true, sent: 0, note: 'RESEND_API_KEY not configured' })

    const supabase = createServerClient()
    let sent = 0

    for (const tag of tags) {
      if (tag === author) continue

      const email = USER_EMAILS[tag]
      if (!email) continue

      // Check if user has email notifications enabled
      const { data: pref } = await supabase
        .from('settings')
        .select('value')
        .eq('key', `email_notifs_${tag}`)
        .single()
      if (pref?.value === false) continue

      const typeLabel = type === 'meeting' ? 'meeting' : type === 'action' ? 'action item' : 'post'
      const preview = (text || '').replace(/<[^>]*>/g, '').slice(0, 200)

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: 'Discovery Hub <notifications@updates.shrsde.com>',
            to: email,
            subject: `${author} mentioned you in a ${typeLabel}`,
            html: `
              <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
                <div style="font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">Discovery Hub</div>
                <div style="background: #f8f8f8; border: 1px solid #e8e8e8; border-radius: 12px; padding: 16px;">
                  <div style="font-size: 14px; font-weight: 600; color: #0d0e0e; margin-bottom: 8px;">
                    ${author} mentioned you in a ${typeLabel}
                  </div>
                  <div style="font-size: 13px; color: #666; line-height: 1.5;">
                    ${preview}
                  </div>
                </div>
                <div style="margin-top: 16px; text-align: center;">
                  <a href="https://discovery-hub-fe.vercel.app/feed" style="display: inline-block; padding: 10px 24px; background: #0d0e0e; color: white; text-decoration: none; border-radius: 9999px; font-size: 13px; font-weight: 600;">
                    View on Discovery Hub
                  </a>
                </div>
              </div>
            `,
          }),
        })
        sent++
      } catch (e) {
        console.error(`Failed to notify ${tag}:`, e)
      }
    }

    return NextResponse.json({ success: true, sent })
  } catch (err) {
    console.error('Notify error:', err)
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
