import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'
import { getValidAccessToken } from '@/lib/google'

const DRIVE_CONVERTIBLE_EXT = {
  'docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', google: 'application/vnd.google-apps.document' },
  'doc': { mime: 'application/msword', google: 'application/vnd.google-apps.document' },
  'txt': { mime: 'text/plain', google: 'application/vnd.google-apps.document' },
  'md': { mime: 'text/markdown', google: 'application/vnd.google-apps.document' },
  'rtf': { mime: 'application/rtf', google: 'application/vnd.google-apps.document' },
  'html': { mime: 'text/html', google: 'application/vnd.google-apps.document' },
  'pdf': { mime: 'application/pdf', google: 'application/vnd.google-apps.document' },
  'xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', google: 'application/vnd.google-apps.spreadsheet' },
  'xls': { mime: 'application/vnd.ms-excel', google: 'application/vnd.google-apps.spreadsheet' },
  'csv': { mime: 'text/csv', google: 'application/vnd.google-apps.spreadsheet' },
  'tsv': { mime: 'text/tab-separated-values', google: 'application/vnd.google-apps.spreadsheet' },
  'pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', google: 'application/vnd.google-apps.presentation' },
}

function getEmbedUrl(fileId, mimeType) {
  if (mimeType === 'application/vnd.google-apps.spreadsheet')
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit?embedded=true&rm=minimal`
  if (mimeType === 'application/vnd.google-apps.presentation')
    return `https://docs.google.com/presentation/d/${fileId}/edit?embedded=true`
  return `https://docs.google.com/document/d/${fileId}/edit?embedded=true`
}

function getWebViewUrl(fileId, mimeType) {
  if (mimeType === 'application/vnd.google-apps.spreadsheet')
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit`
  if (mimeType === 'application/vnd.google-apps.presentation')
    return `https://docs.google.com/presentation/d/${fileId}/edit`
  return `https://docs.google.com/document/d/${fileId}/edit`
}

// One-time migration: find all feed posts with document attachments,
// download from Supabase storage, push to Google Drive, update feed records
export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const supabase = createServerClient()
  const accessToken = await getValidAccessToken(supabase)

  // Get or create Drive folder
  const { data: folderSetting } = await supabase
    .from('settings').select('value').eq('key', 'google_drive_folder_id').single()
  let folderId = folderSetting?.value
  if (!folderId) {
    const folderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Discovery Hub', mimeType: 'application/vnd.google-apps.folder' }),
    })
    const folder = await folderRes.json()
    folderId = folder.id
    await supabase.from('settings').upsert({ key: 'google_drive_folder_id', value: folderId, updated_at: new Date().toISOString() })
  }

  // Find all feed posts with attachments or document media
  const { data: posts } = await supabase
    .from('feed')
    .select('id, media_url, media_type, media_name, attachments')
    .order('created_at', { ascending: false })

  const results = { migrated: 0, skipped: 0, failed: 0, errors: [] }

  for (const post of (posts || [])) {
    // Collect all document URLs to migrate
    const toMigrate = []

    // Legacy single media
    if (post.media_type === 'document' && post.media_url) {
      const ext = (post.media_name || post.media_url).split('.').pop().toLowerCase()
      if (DRIVE_CONVERTIBLE_EXT[ext]) {
        toMigrate.push({ url: post.media_url, name: post.media_name || `document.${ext}`, ext, source: 'media' })
      }
    }

    // Multi-attachments
    if (Array.isArray(post.attachments)) {
      for (let i = 0; i < post.attachments.length; i++) {
        const att = post.attachments[i]
        if (att.embed_url) continue // Already migrated
        if (att.type !== 'document') continue
        const ext = (att.name || att.url || '').split('.').pop().toLowerCase()
        if (DRIVE_CONVERTIBLE_EXT[ext]) {
          toMigrate.push({ url: att.url, name: att.name || `document.${ext}`, ext, source: 'attachment', index: i })
        }
      }
    }

    if (toMigrate.length === 0) { results.skipped++; continue }

    for (const item of toMigrate) {
      try {
        // Download file from Supabase storage
        const fileRes = await fetch(item.url)
        if (!fileRes.ok) { results.failed++; results.errors.push(`Download failed: ${item.name}`); continue }
        const buffer = Buffer.from(await fileRes.arrayBuffer())

        const extInfo = DRIVE_CONVERTIBLE_EXT[item.ext]

        // Upload to Google Drive with conversion
        const boundary = '---dh-migrate'
        const metadata = JSON.stringify({
          name: item.name,
          mimeType: extInfo.google,
          parents: [folderId],
        })
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
          Buffer.from(`--${boundary}\r\nContent-Type: ${extInfo.mime}\r\n\r\n`),
          buffer,
          Buffer.from(`\r\n--${boundary}--`),
        ])

        const driveRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        })
        const driveFile = await driveRes.json()

        if (!driveFile.id) { results.failed++; results.errors.push(`Drive upload failed: ${item.name}`); continue }

        // Make publicly editable
        await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'writer', type: 'anyone' }),
        })

        const embedUrl = getEmbedUrl(driveFile.id, driveFile.mimeType)
        const webViewUrl = driveFile.webViewLink || getWebViewUrl(driveFile.id, driveFile.mimeType)

        // Update the feed post
        if (item.source === 'attachment') {
          const attachments = [...post.attachments]
          attachments[item.index] = {
            ...attachments[item.index],
            embed_url: embedUrl,
            web_view_url: webViewUrl,
            google_file_id: driveFile.id,
          }
          await supabase.from('feed').update({ attachments }).eq('id', post.id)
        }

        // Save to documents table
        const existing = await supabase.from('documents').select('id').eq('google_file_id', driveFile.id).single()
        if (!existing.data) {
          await supabase.from('documents').insert({
            title: item.name,
            google_file_id: driveFile.id,
            google_mime_type: driveFile.mimeType,
            embed_url: embedUrl,
            web_view_url: webViewUrl,
            original_filename: item.name,
            original_mime_type: extInfo.mime,
            file_size_bytes: buffer.length,
            created_by: 'Wes',
          })
        }

        results.migrated++
      } catch (e) {
        results.failed++
        results.errors.push(`${item.name}: ${e.message}`)
      }
    }
  }

  return NextResponse.json({ success: true, ...results })
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
