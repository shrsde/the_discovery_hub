import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { authenticateRequest, logSession } from '@/lib/auth'
import { getValidAccessToken } from '@/lib/google'

const CONVERSION_MAP = {
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
  'text/tab-separated-values': 'application/vnd.google-apps.spreadsheet',
}

function getEmbedUrl(fileId, mimeType) {
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit?embedded=true&rm=minimal`
  }
  return `https://docs.google.com/document/d/${fileId}/edit?embedded=true`
}

function getWebViewUrl(fileId, mimeType) {
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit`
  }
  return `https://docs.google.com/document/d/${fileId}/edit`
}

// Ensure a "Discovery Hub" folder exists in Drive, return its ID
async function getOrCreateFolder(accessToken, supabase) {
  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'google_drive_folder_id')
    .single()

  if (setting?.value) return setting.value

  // Create folder
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Discovery Hub',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  })
  const folder = await res.json()
  if (folder.error) throw new Error(folder.error.message)

  await supabase.from('settings').upsert({
    key: 'google_drive_folder_id',
    value: folder.id,
    updated_at: new Date().toISOString(),
  })

  return folder.id
}

async function setFilePublic(accessToken, fileId) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'writer', type: 'anyone' }),
  })
}

export async function GET(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response

  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const projectId = searchParams.get('project_id')

  if (id) {
    const { data, error } = await supabase.from('documents').select('*').eq('id', id).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  }

  let query = supabase.from('documents').select('*').order('updated_at', { ascending: false })
  if (projectId) query = query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const supabase = createServerClient()

  // Check content type to determine if this is a form upload or JSON create
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    // Upload flow
    const formData = await request.formData()
    const file = formData.get('file')
    const title = formData.get('title') || file?.name || 'Untitled'
    const createdBy = formData.get('created_by') || 'Wes'
    const projectId = formData.get('project_id') || null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const accessToken = await getValidAccessToken(supabase)
    const folderId = await getOrCreateFolder(accessToken, supabase)

    const googleMimeType = CONVERSION_MAP[file.type] || 'application/vnd.google-apps.document'
    const fileBuffer = Buffer.from(await file.arrayBuffer())

    // Multipart upload with conversion
    const boundary = '---discovery-hub-upload'
    const metadata = JSON.stringify({
      name: title,
      mimeType: googleMimeType,
      parents: [folderId],
    })

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ])

    const driveRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,iconLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })

    const driveFile = await driveRes.json()
    if (driveFile.error) return NextResponse.json({ error: driveFile.error.message }, { status: 400 })

    await setFilePublic(accessToken, driveFile.id)

    const record = {
      title,
      google_file_id: driveFile.id,
      google_mime_type: driveFile.mimeType,
      embed_url: getEmbedUrl(driveFile.id, driveFile.mimeType),
      web_view_url: driveFile.webViewLink || getWebViewUrl(driveFile.id, driveFile.mimeType),
      original_filename: file.name,
      original_mime_type: file.type,
      file_size_bytes: fileBuffer.length,
      created_by: createdBy,
      project_id: projectId,
    }

    const { data, error } = await supabase.from('documents').insert(record).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logSession(supabase, {
      author: createdBy,
      action: 'uploaded_document',
      entity_type: 'document',
      entity_id: data.id,
      summary: `Uploaded: ${title}`,
    })

    return NextResponse.json({ success: true, data })
  }

  // JSON create flow
  const body = await request.json()

  if (body.action === 'create') {
    const accessToken = await getValidAccessToken(supabase)
    const folderId = await getOrCreateFolder(accessToken, supabase)

    const googleMimeType = body.type === 'sheet'
      ? 'application/vnd.google-apps.spreadsheet'
      : 'application/vnd.google-apps.document'

    const driveRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: body.title || 'Untitled',
        mimeType: googleMimeType,
        parents: [folderId],
      }),
    })

    const driveFile = await driveRes.json()
    if (driveFile.error) return NextResponse.json({ error: driveFile.error.message }, { status: 400 })

    await setFilePublic(accessToken, driveFile.id)

    const record = {
      title: body.title || 'Untitled',
      google_file_id: driveFile.id,
      google_mime_type: googleMimeType,
      embed_url: getEmbedUrl(driveFile.id, googleMimeType),
      web_view_url: getWebViewUrl(driveFile.id, googleMimeType),
      created_by: body.created_by || 'Wes',
      project_id: body.project_id || null,
    }

    const { data, error } = await supabase.from('documents').insert(record).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logSession(supabase, {
      author: record.created_by,
      action: 'created_document',
      entity_type: 'document',
      entity_id: data.id,
      summary: `Created ${body.type === 'sheet' ? 'Sheet' : 'Doc'}: ${record.title}`,
    })

    return NextResponse.json({ success: true, data })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function PATCH(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.tags !== undefined) updates.tags = body.tags
  if (body.project_id !== undefined) updates.project_id = body.project_id
  updates.updated_at = new Date().toISOString()

  // Rename on Google Drive if title changed
  if (body.title) {
    try {
      const accessToken = await getValidAccessToken(supabase)
      const { data: doc } = await supabase.from('documents').select('google_file_id').eq('id', body.id).single()
      if (doc?.google_file_id) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${doc.google_file_id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: body.title }),
        })
      }
    } catch (e) { console.error('Drive rename failed:', e) }
  }

  const { data, error } = await supabase.from('documents').update(updates).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, data })
}

export async function DELETE(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  const body = await request.json()
  const supabase = createServerClient()

  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Get google file ID before deleting
  const { data: doc } = await supabase.from('documents').select('google_file_id').eq('id', body.id).single()

  // Trash on Google Drive
  if (doc?.google_file_id) {
    try {
      const accessToken = await getValidAccessToken(supabase)
      await fetch(`https://www.googleapis.com/drive/v3/files/${doc.google_file_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })
    } catch (e) { console.error('Drive delete failed:', e) }
  }

  // Remove from project_items
  await supabase.from('project_items').delete().eq('item_type', 'document').eq('item_id', body.id)

  const { error } = await supabase.from('documents').delete().eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
