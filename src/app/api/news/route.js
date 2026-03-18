import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'

const RSS_FEEDS = [
  { name: 'Food Dive', url: 'https://www.fooddive.com/feeds/news/', category: 'Industry' },
  { name: 'Grocery Dive', url: 'https://www.grocerydive.com/feeds/news/', category: 'Retail' },
  { name: 'Progressive Grocer', url: 'https://progressivegrocer.com/rss.xml', category: 'Retail' },
  { name: 'Food Business News', url: 'https://www.foodbusinessnews.net/rss', category: 'Industry' },
  { name: 'NOSH', url: 'https://www.nosh.com/rss', category: 'CPG' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', category: 'AI' },
  { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/', category: 'AI' },
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', category: 'AI' },
]

function parseItem(itemStr, source, category) {
  const get = (tag) => {
    const match = itemStr.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
    return match ? match[1].trim() : ''
  }

  const title = get('title').replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1')
  const link = get('link').replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1')
  const rawDesc = get('description').replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1')
  const desc = rawDesc.replace(/<[^>]*>/g, '').trim()
  const pubDate = get('pubDate')

  const imgMatch = rawDesc.match(/src="([^"]*)"/)
  const thumbnail = imgMatch ? imgMatch[1] : null

  if (!title) return null

  return {
    title,
    link,
    description: desc.slice(0, 300),
    pubDate,
    source,
    category,
    thumbnail,
  }
}

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  try {
    const allArticles = []

    const results = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'DiscoveryHub/1.0' },
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return []
        const xml = await res.text()

        const items = xml.split('<item>').slice(1, 16)
        return items.map(item => parseItem(item, feed.name, feed.category)).filter(Boolean)
      })
    )

    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) {
        allArticles.push(...r.value)
      }
    })

    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))

    return NextResponse.json({ data: allArticles })
  } catch (err) {
    console.error('News fetch error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
