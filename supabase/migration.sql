-- Discovery Hub: Supabase Schema
-- Run in Supabase SQL Editor → New Query → Paste → Run

-- ── INTERVIEWS ──
create table if not exists interviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  date date not null default current_date,
  interviewer text not null check (interviewer in ('Wes', 'Gibb')),
  interviewee_name text,
  company text,
  role text,
  department text,
  company_size text,
  channels text[] default '{}',
  distributors text,
  connection_source text,
  workflow_steps text,
  systems_tools text,
  data_sources text,
  handoffs text,
  time_spent text,
  workarounds text,
  pain_points jsonb default '[]'::jsonb,
  tools_evaluated text,
  why_failed text,
  current_spend text,
  budget_authority text,
  willingness_to_pay text,
  integration_reqs text,
  verbatim_quotes text,
  observations text,
  surprises text,
  follow_ups text,
  intel_vs_judgement integer default 50,
  outsourced_vs_insourced text,
  autopilot_vs_copilot text,
  biggest_signal text,
  confidence integer default 3 check (confidence between 1 and 5),
  score_founder_fit integer default 0 check (score_founder_fit between 0 and 5),
  score_lowest_friction integer default 0 check (score_lowest_friction between 0 and 5),
  score_clearest_value integer default 0 check (score_clearest_value between 0 and 5),
  score_defensibility integer default 0 check (score_defensibility between 0 and 5),
  score_ease_de_risk integer default 0 check (score_ease_de_risk between 0 and 5),
  score_stickiness integer default 0 check (score_stickiness between 0 and 5),
  score_total integer generated always as (
    score_founder_fit + score_lowest_friction + score_clearest_value +
    score_defensibility + score_ease_de_risk + score_stickiness
  ) stored,
  notes text
);

-- ── FEED ──
create table if not exists feed (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  author text not null check (author in ('Wes', 'Gibb')),
  type text not null check (type in ('insight','hypothesis','challenge','competitive','action','question')),
  text text not null,
  linked_interview_id uuid references interviews(id) on delete set null,
  resolved boolean default false
);

-- ── SYNCS ──
create table if not exists syncs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  author text not null check (author in ('Wes', 'Gibb')),
  type text not null check (type in ('synthesis','competitive','product','decision','research','framework')),
  status text default 'Active' check (status in ('Draft','Active','Superseded','Archived')),
  title text not null,
  key_takeaways text,
  content text,
  implications text,
  next_steps text,
  linked_interview_ids uuid[] default '{}',
  linked_sync_ids uuid[] default '{}'
);

-- ── SESSIONS (changelog) ──
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  author text not null check (author in ('Wes', 'Gibb')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text
);

-- ── DIGESTS ──
create table if not exists digests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  trigger_type text not null check (trigger_type in ('auto','on_demand')),
  requested_by text,
  since_timestamp timestamptz,
  summary text not null,
  details jsonb
);

-- ── INDEXES ──
create index idx_interviews_date on interviews(date desc);
create index idx_feed_created on feed(created_at desc);
create index idx_syncs_created on syncs(created_at desc);
create index idx_sessions_created on sessions(created_at desc);
create index idx_digests_created on digests(created_at desc);

-- ── RLS (open for now — both users have full access via service key) ──
alter table interviews enable row level security;
alter table feed enable row level security;
alter table syncs enable row level security;
alter table sessions enable row level security;
alter table digests enable row level security;

create policy "open" on interviews for all using (true) with check (true);
create policy "open" on feed for all using (true) with check (true);
create policy "open" on syncs for all using (true) with check (true);
create policy "open" on sessions for all using (true) with check (true);
create policy "open" on digests for all using (true) with check (true);

-- ── UPDATED_AT TRIGGER ──
create or replace function update_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger interviews_updated before update on interviews for each row execute function update_updated_at();
create trigger syncs_updated before update on syncs for each row execute function update_updated_at();
