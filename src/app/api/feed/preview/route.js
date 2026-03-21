import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const { url } = await request.json()
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryHubBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })

    const html = await res.text()

    // Extract Open Graph / meta tags
    const getTag = (name) => {
      const match = html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'))
      return match?.[1] || ''
    }

    const title = getTag('og:title') || getTag('twitter:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim()
    const description = getTag('og:description') || getTag('twitter:description') || getTag('description')
    const image = getTag('og:image') || getTag('twitter:image')
    const siteName = getTag('og:site_name') || new URL(url).hostname.replace('www.', '')

    if (!title && !description) {
      return NextResponse.json({ error: 'No metadata found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        url,
        title: title.slice(0, 200),
        description: description.slice(0, 300),
        image: image || null,
        site_name: siteName,
      }
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch URL metadata' }, { status: 400 })
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
