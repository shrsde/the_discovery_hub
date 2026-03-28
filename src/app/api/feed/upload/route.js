import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest } from '@/lib/auth'

const DRIVE_CONVERTIBLE = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
  'application/msword': 'application/vnd.google-apps.document',
  'text/plain': 'application/vnd.google-apps.document',
  'text/markdown': 'application/vnd.google-apps.document',
  'text/html': 'application/vnd.google-apps.document',
  'application/rtf': 'application/vnd.google-apps.document',
  'application/pdf': 'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
  'text/csv': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
}

// Also match by extension for cases where mime type is generic
const EXT_TO_GOOGLE = {
  'docx': 'application/vnd.google-apps.document',
  'doc': 'application/vnd.google-apps.document',
  'txt': 'application/vnd.google-apps.document',
  'md': 'application/vnd.google-apps.document',
  'rtf': 'application/vnd.google-apps.document',
  'html': 'application/vnd.google-apps.document',
  'pdf': 'application/vnd.google-apps.document',
  'xlsx': 'application/vnd.google-apps.spreadsheet',
  'xls': 'application/vnd.google-apps.spreadsheet',
  'csv': 'application/vnd.google-apps.spreadsheet',
  'tsv': 'application/vnd.google-apps.spreadsheet',
  'pptx': 'application/vnd.google-apps.presentation',
}

function getEmbedUrl(fileId, mimeType) {
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit?embedded=true&rm=minimal`
  }
  if (mimeType === 'application/vnd.google-apps.presentation') {
    return `https://docs.google.com/presentation/d/${fileId}/edit?embedded=true`
  }
  return `https://docs.google.com/document/d/${fileId}/edit?embedded=true`
}

function getWebViewUrl(fileId, mimeType) {
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit`
  }
  if (mimeType === 'application/vnd.google-apps.presentation') {
    return `https://docs.google.com/presentation/d/${fileId}/edit`
  }
  return `https://docs.google.com/document/d/${fileId}/edit`
}

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const supabase = createServerClient()
    const ext = file.name.split('.').pop().toLowerCase()
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    // Determine media type
    let mediaType = 'document'
    if (file.type.startsWith('image/')) mediaType = 'image'
    else if (file.type.startsWith('video/')) mediaType = 'video'

    const buffer = Buffer.from(await file.arrayBuffer())

    // Upload to Supabase storage (always — serves as backup/download)
    const { error: storageErr } = await supabase.storage
      .from('feed-media')
      .upload(filename, buffer, { contentType: file.type, upsert: false })

    if (storageErr) return NextResponse.json({ error: storageErr.message }, { status: 400 })

    const { data: urlData } = supabase.storage.from('feed-media').getPublicUrl(filename)

    // Check if this is a document type that can be converted to Google Docs/Sheets
    const googleMimeType = DRIVE_CONVERTIBLE[file.type] || EXT_TO_GOOGLE[ext]

    let driveData = null
    if (googleMimeType && mediaType === 'document') {
      try {
        const { getValidAccessToken } = await import('@/lib/google')
        const accessToken = await getValidAccessToken(supabase)

        // Get or create Discovery Hub folder
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

        // Upload to Google Drive with conversion
        const boundary = '---dh-upload'
        const metadata = JSON.stringify({
          name: file.name,
          mimeType: googleMimeType,
          parents: [folderId],
        })
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
          Buffer.from(`--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`),
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

        if (driveFile.id) {
          // Make publicly editable
          await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'writer', type: 'anyone' }),
          })

          driveData = {
            google_file_id: driveFile.id,
            google_mime_type: driveFile.mimeType,
            embed_url: getEmbedUrl(driveFile.id, driveFile.mimeType),
            web_view_url: driveFile.webViewLink || getWebViewUrl(driveFile.id, driveFile.mimeType),
          }

          // Also save to documents table for the Index
          await supabase.from('documents').insert({
            title: file.name,
            google_file_id: driveFile.id,
            google_mime_type: driveFile.mimeType,
            embed_url: driveData.embed_url,
            web_view_url: driveData.web_view_url,
            original_filename: file.name,
            original_mime_type: file.type,
            file_size_bytes: buffer.length,
            created_by: 'Wes',
          })
        }
      } catch (e) {
        console.error('Google Drive upload failed (falling back to Supabase only):', e)
      }
    }

    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      mediaType,
      mediaName: file.name,
      ...(driveData || {}),
    })
  } catch (err) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
