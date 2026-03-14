# Discovery Hub — Setup & Usage Guide

## Architecture

Two independent repos:

```
discovery-hub-api/     ← Headless API + Supabase (this repo)
  └── Deploys to Vercel as API-only service
  └── All data endpoints, auth, digest generation

discovery-hub-app/     ← Frontend UI (separate repo)
  └── Deploys independently to Vercel
  └── Consumes the API via fetch
  └── Can be swapped/rebuilt without touching data layer
```

---

## Setup: API (this repo)

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project (free tier works)
2. Once created, go to **SQL Editor** → New Query
3. Paste the contents of `supabase/migration.sql` → Run
4. Go to **Settings → API** and copy:
   - Project URL (e.g. `https://abc123.supabase.co`)
   - `anon` public key
   - `service_role` key (keep this secret)

### 2. Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import Project → Select repo
3. Add environment variables in Vercel dashboard:

```
NEXT_PUBLIC_SUPABASE_URL = https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = your-anon-key
SUPABASE_SERVICE_ROLE_KEY = your-service-role-key
DISCOVERY_HUB_API_KEY = (generate: openssl rand -hex 32)
ANTHROPIC_API_KEY = your-anthropic-key
```

4. Deploy. Your API is now live at `https://your-api.vercel.app`

### 3. Test

```bash
# Health check
curl https://your-api.vercel.app/api/context \
  -H "Authorization: Bearer YOUR_API_KEY"

# Post a test feed item
curl -X POST https://your-api.vercel.app/api/feed \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"author":"Wes","type":"insight","text":"Testing the API"}'
```

---

## Using from Claude Sessions

### Starting a session with full context

Tell Claude:

> "Fetch my project context from https://your-api.vercel.app/api/context with Authorization Bearer YOUR_API_KEY"

Or for changes since a specific time:

> "Fetch context since yesterday from https://your-api.vercel.app/api/context?since=2026-03-14T00:00:00Z"

Claude will use web_fetch to pull the full structured database and have complete context.

### Pushing an interview

After capturing interview data, tell Claude:

> "Push this interview to the Discovery Hub"

Claude will POST to `/api/interview` with the structured data. Example payload:

```json
{
  "interviewer": "Gibb",
  "intervieweeName": "Sarah Chen",
  "company": "Purely Organic",
  "role": "VP Trade Marketing",
  "department": "Trade Marketing",
  "companySize": "$50M revenue, 120 employees",
  "channels": ["Retail", "Club"],
  "distributors": "UNFI, KeHE",
  "painPoints": [
    {
      "description": "We lose $400K/year to invalid deductions we don't have time to dispute",
      "category": "Overhead Savings",
      "dollar_impact": "$400K/year",
      "frequency": "Weekly",
      "who_feels": "Finance team + Trade Marketing",
      "current_solution": "Manual spreadsheet tracking, mostly write-offs"
    }
  ],
  "biggestSignal": "Deduction recovery is a massive pain — they know the $ but can't act on it",
  "confidence": 4,
  "scores": {
    "founderFit": 4,
    "lowestFriction": 3,
    "clearestValue": 5,
    "defensibility": 3,
    "easeDeRisk": 4,
    "stickiness": 4
  }
}
```

### Pushing a synthesis

After running analysis, tell Claude:

> "Push this synthesis to the Hub"

Claude POSTs to `/api/sync`:

```json
{
  "author": "Wes",
  "type": "synthesis",
  "title": "Interviews 1-3: Deductions pattern emerging",
  "keyTakeaways": "3/3 interviews mentioned deduction recovery as top pain. Dollar impact ranges from $200K-$800K/year. All currently using manual processes or write-offs.",
  "content": "(full synthesis output here)",
  "implications": "Deductions may be our strongest wedge. High intelligence ratio, already partially outsourced at larger brands.",
  "nextSteps": "Gibb: probe deductions specifically in next 2 interviews. Wes: map competitive landscape for deduction recovery tools."
}
```

### Posting a quick insight

> "Post to the feed: Just heard from the third interviewee that UNFI's portal data is the bottleneck for deduction disputes"

Claude POSTs to `/api/feed`:

```json
{
  "author": "Wes",
  "type": "insight",
  "text": "Third interviewee confirmed: UNFI portal data is the bottleneck for deduction disputes. Same pattern as interviews 1 and 2."
}
```

### Getting a digest

> "What's changed in the Discovery Hub since yesterday?"

Claude POSTs to `/api/digest`:

```json
{
  "author": "Gibb",
  "since": "2026-03-14T00:00:00Z"
}
```

Returns an AI-generated summary of all changes.

---

## API Reference

All endpoints require: `Authorization: Bearer <DISCOVERY_HUB_API_KEY>`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/interview` | Create/update interview (include `id` to update) |
| GET | `/api/interview` | List all interviews |
| POST | `/api/feed` | Post a feed item |
| GET | `/api/feed` | List all feed items |
| POST | `/api/sync` | Create/update a sync entry |
| GET | `/api/sync` | List all sync entries |
| GET | `/api/context` | Full DB as text (add `?format=json` for JSON) |
| GET | `/api/context?since=<ISO>` | Changes since timestamp |
| POST | `/api/digest` | Generate on-demand digest |
| GET | `/api/digest` | Get latest digest(s) |
| GET | `/api/changelog` | Activity log |
| GET | `/api/changelog?since=<ISO>` | Activity since timestamp |

---

## Frontend (separate repo)

The `discovery-hub-app` repo is your UI. It can be:

- The React artifact we built in Claude (pointed at the API instead of local storage)
- A Next.js app with full pages
- A mobile-first PWA
- Anything that calls the API

The API doesn't care what the frontend looks like. Build, rebuild, or swap it independently.

### Connecting a frontend

Set one environment variable in your frontend:

```
NEXT_PUBLIC_API_URL=https://your-api.vercel.app
NEXT_PUBLIC_API_KEY=your-api-key
```

Then fetch:

```js
const API = process.env.NEXT_PUBLIC_API_URL
const KEY = process.env.NEXT_PUBLIC_API_KEY

// Get all interviews
const res = await fetch(`${API}/api/interview`, {
  headers: { 'Authorization': `Bearer ${KEY}` }
})
const { data } = await res.json()
```
