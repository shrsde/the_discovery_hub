-- Feed Enhancements: pinning, archiving, media, tagging
-- Run in Supabase SQL Editor

ALTER TABLE feed ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false;
ALTER TABLE feed ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;
ALTER TABLE feed ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE feed ADD COLUMN IF NOT EXISTS media_type text CHECK (media_type IN ('image', 'video', 'document', 'video_link'));
ALTER TABLE feed ADD COLUMN IF NOT EXISTS media_name text;
ALTER TABLE feed ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE feed ADD COLUMN IF NOT EXISTS summary text;

CREATE INDEX IF NOT EXISTS idx_feed_pinned ON feed(pinned) WHERE pinned = true;
CREATE INDEX IF NOT EXISTS idx_feed_archived ON feed(archived);

-- Create storage bucket for feed media (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('feed-media', 'feed-media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to feed media
CREATE POLICY "public_read_feed_media" ON storage.objects
FOR SELECT USING (bucket_id = 'feed-media');

-- Allow authenticated uploads via service key (already handled by service role)
CREATE POLICY "service_upload_feed_media" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'feed-media');

CREATE POLICY "service_delete_feed_media" ON storage.objects
FOR DELETE USING (bucket_id = 'feed-media');
