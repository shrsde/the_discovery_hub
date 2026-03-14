export default function Home() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: 40, maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>⬡ Discovery Hub API</h1>
      <p style={{ color: '#64748B', marginBottom: 24 }}>Backend service for the CPG Discovery Research Platform</p>
      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Endpoints</h3>
        <pre style={{ fontSize: 12, lineHeight: 1.8, color: '#334155' }}>{`
POST /api/interview    Push/update interview data
GET  /api/interview    List all interviews

POST /api/feed         Post a feed item
GET  /api/feed         List feed items

POST /api/sync         Push a session output
GET  /api/sync         List sync entries

GET  /api/context      Full DB export (text or JSON)
GET  /api/context?format=json
GET  /api/context?since=<ISO timestamp>

POST /api/digest       Generate on-demand summary
GET  /api/digest       Get latest digest(s)

GET  /api/changelog    Activity log
GET  /api/changelog?since=<ISO timestamp>

All endpoints require:
  Authorization: Bearer <DISCOVERY_HUB_API_KEY>
        `.trim()}</pre>
      </div>
    </div>
  )
}
