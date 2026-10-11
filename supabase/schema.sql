-- ForkLog Live schema. No auth for the hackathon: every row uses the demo user id.
create extension if not exists "pgcrypto";

create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  source_video_path text,          -- storage path in bucket "videos"
  source_summary text,
  created_at timestamptz default now()
);

create table versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references recipes(id) on delete cascade,
  number int not null,             -- 1 = extracted from video
  parent_id uuid references versions(id),
  recipe_json jsonb not null,      -- RecipeSchema
  diff_json jsonb,                 -- DiffItem[] vs parent
  rating int check (rating between 1 and 10),
  notes text,
  is_best boolean default false,
  created_at timestamptz default now(),
  unique (recipe_id, number)
);

create table ref_frames (
  version_id uuid references versions(id) on delete cascade,
  step_n int not null,
  storage_path text not null,      -- bucket "frames"
  primary key (version_id, step_n)
);

create table cooks (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references recipes(id) on delete cascade,
  base_version_id uuid references versions(id),
  started_at timestamptz default now(),
  ended_at timestamptz,
  rating int,
  notes text,
  saved_version_id uuid references versions(id)
);

create table cook_events (
  id bigserial primary key,
  cook_id uuid references cooks(id) on delete cascade,
  step_n int not null,
  at timestamptz default now(),
  event jsonb not null             -- CoachEventSchema
);
create index on cook_events (cook_id, at);

-- storage buckets (run via dashboard or CLI): videos (private), frames (private)
insert into storage.buckets (id, name, public) values ('videos','videos',false), ('frames','frames',false)
on conflict do nothing;

-- hackathon RLS: open. Tighten before any real users.
alter table recipes enable row level security;
alter table versions enable row level security;
alter table cooks enable row level security;
alter table cook_events enable row level security;
alter table ref_frames enable row level security;
create policy "open" on recipes for all using (true) with check (true);
create policy "open" on versions for all using (true) with check (true);
create policy "open" on cooks for all using (true) with check (true);
create policy "open" on cook_events for all using (true) with check (true);
create policy "open" on ref_frames for all using (true) with check (true);
