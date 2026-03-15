-- Discovery Hub: Iteration 3 — Attachments, Meetings, Tasks
-- Run in Supabase SQL Editor

-- ── ATTACHMENTS ──
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL CHECK (uploaded_by IN ('Wes', 'Gibb')),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  parsed_text TEXT,
  summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachments_interview ON attachments(interview_id);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open" ON attachments FOR ALL USING (true) WITH CHECK (true);

-- Storage bucket for interview attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('interview-attachments', 'interview-attachments', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public_read_interview_attachments" ON storage.objects
FOR SELECT USING (bucket_id = 'interview-attachments');
CREATE POLICY "service_upload_interview_attachments" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'interview-attachments');
CREATE POLICY "service_delete_interview_attachments" ON storage.objects
FOR DELETE USING (bucket_id = 'interview-attachments');

-- ── MEETINGS ──
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  scheduled_at TIMESTAMPTZ,
  title TEXT NOT NULL,
  organizer TEXT NOT NULL CHECK (organizer IN ('Wes', 'Gibb')),
  attendees TEXT[] DEFAULT '{}',
  meet_link TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  recording_url TEXT,
  transcript TEXT,
  parsed_summary TEXT,
  linked_interview_ids UUID[] DEFAULT '{}',
  linked_task_ids UUID[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_meetings_created ON meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open" ON meetings FOR ALL USING (true) WITH CHECK (true);

-- Storage bucket for meeting recordings
INSERT INTO storage.buckets (id, name, public)
VALUES ('meeting-recordings', 'meeting-recordings', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public_read_meeting_recordings" ON storage.objects
FOR SELECT USING (bucket_id = 'meeting-recordings');
CREATE POLICY "service_upload_meeting_recordings" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'meeting-recordings');
CREATE POLICY "service_delete_meeting_recordings" ON storage.objects
FOR DELETE USING (bucket_id = 'meeting-recordings');

-- ── TASKS ──
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
  assignee TEXT CHECK (assignee IN ('Wes', 'Gibb')),
  due_date DATE,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  source_type TEXT CHECK (source_type IN ('manual', 'meeting', 'interview', 'feed', 'sync')),
  source_id UUID,
  position INTEGER DEFAULT 0,
  created_by TEXT NOT NULL CHECK (created_by IN ('Wes', 'Gibb'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open" ON tasks FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER tasks_updated BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── UPDATE FEED TYPE CONSTRAINT ──
ALTER TABLE feed DROP CONSTRAINT IF EXISTS feed_type_check;
ALTER TABLE feed ADD CONSTRAINT feed_type_check
CHECK (type IN ('insight', 'hypothesis', 'challenge', 'competitive', 'action', 'question', 'meeting'));
