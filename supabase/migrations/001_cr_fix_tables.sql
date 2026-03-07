-- cr_fix_requests: one row per PR fix lifecycle
create table cr_fix_requests (
  id            uuid primary key default gen_random_uuid(),
  repo          text not null,
  pr_number     int not null,
  pr_url        text not null,
  branch        text not null,
  base_branch   text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'fixing', 'waiting_review', 'clean', 'stuck', 'failed', 'cancelled')),
  current_round int not null default 0,
  max_rounds    int not null default 3,
  triggered_by  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  unique (repo, pr_number)
);

-- cr_fix_rounds: one row per fix attempt
create table cr_fix_rounds (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references cr_fix_requests(id) on delete cascade,
  round_number  int not null,
  commit_sha    text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   int,
  status        text not null default 'running'
                check (status in ('running', 'completed', 'failed')),
  error         text
);

-- Enable Realtime on fix_requests (REQ-S05)
alter publication supabase_realtime add table cr_fix_requests;

-- RLS: publishable key = read-only (REQ-S06)
alter table cr_fix_requests enable row level security;
alter table cr_fix_rounds enable row level security;

create policy "read_fix_requests" on cr_fix_requests
  for select using (true);

create policy "read_fix_rounds" on cr_fix_rounds
  for select using (true);

-- Secret key (service role) bypasses RLS automatically (REQ-S07)
