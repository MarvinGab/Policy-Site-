-- Full schema for policies.zarohr.
--
-- One file, idempotent. Run this in the Supabase SQL Editor:
--   * on a fresh database — it sets everything up
--   * on an existing database — it's a no-op for things that already exist
--     and only adds missing columns/indexes/constraints
--
-- The historical migration-phase{1..4}.sql files have been folded in here.

create extension if not exists vector;

-- ============================================================================
-- Companies (one row per org).
-- ============================================================================

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  access_token text,
  access_mode text not null default 'standalone'
    check (access_mode in ('standalone', 'hrms_link')),
  created_at timestamptz not null default now()
);

-- Catch-up for older databases that pre-date these columns.
alter table companies
  add column if not exists access_token text,
  add column if not exists access_mode text not null default 'standalone';

-- The CHECK constraint may not exist on older rows that pre-date this column;
-- re-applying it is safe if it's already there.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_access_mode_check'
  ) then
    alter table companies
      add constraint companies_access_mode_check
      check (access_mode in ('standalone', 'hrms_link'));
  end if;
end$$;

create unique index if not exists companies_access_token_uq on companies(access_token);

-- ============================================================================
-- User profiles (legacy auth used by older flows). The newer per-org users
-- live in org_people; this table is kept for backwards compatibility.
-- ============================================================================

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'hr', 'employee')),
  is_active boolean not null default true,
  company_id uuid references companies(id),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Per-org module → policy → uploaded-document hierarchy.
-- ============================================================================

create table if not exists org_modules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  slug text,
  description text,
  image_url text,
  is_hidden boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- Catch-up for older databases.
alter table org_modules
  add column if not exists slug text,
  add column if not exists description text,
  add column if not exists image_url text,
  add column if not exists is_hidden boolean not null default false,
  add column if not exists position int not null default 0,
  add column if not exists created_at timestamptz not null default now();

create table if not exists org_policies (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references org_modules(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  is_hidden boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table org_policies
  add column if not exists is_hidden boolean not null default false,
  add column if not exists position int not null default 0,
  add column if not exists created_at timestamptz not null default now();

create index if not exists org_modules_company_idx on org_modules(company_id);
create index if not exists org_policies_module_idx on org_policies(module_id);
create index if not exists org_policies_company_idx on org_policies(company_id);

-- ============================================================================
-- Uploaded policy documents + chunked embeddings for chat retrieval.
-- ============================================================================

create table if not exists policy_documents (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  file_path text not null,
  display_name text,
  version_label text,
  effective_date date,
  uploaded_by uuid references user_profiles(id),
  company_id uuid references companies(id),
  created_at timestamptz not null default now()
);

alter table policy_documents
  add column if not exists display_name text,
  add column if not exists version_label text,
  add column if not exists effective_date date,
  add column if not exists created_at timestamptz not null default now();

-- uploaded_by used to be required; relaxed once we started uploading without
-- a user_profiles row (org admins, super admin).
alter table policy_documents alter column uploaded_by drop not null;

create index if not exists policy_documents_policy_id_idx on policy_documents(policy_id);

-- gemini-embedding-001 returns 3072-dim vectors. pgvector's hnsw index on the
-- `vector` type is capped at 2000 dims, so we store as `halfvec` (float16),
-- which supports hnsw up to 4000 dims and halves storage. The precision loss
-- is negligible for cosine-similarity retrieval.
create table if not exists policy_chunks (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  company_id uuid references companies(id),
  document_id uuid references policy_documents(id),
  chunk_text text not null,
  embedding halfvec(3072),
  created_at timestamptz not null default now()
);

-- Catch-up for older databases that created the column as vector(3072).
-- No-op if the column is already halfvec.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'policy_chunks'
      and column_name = 'embedding'
      and udt_name = 'vector'
  ) then
    execute 'alter table policy_chunks alter column embedding type halfvec(3072) using embedding::halfvec(3072)';
  end if;
end$$;

-- Drop stale embedding indexes (ivfflat leftovers, or hnsw built on the old
-- vector type) before (re)creating the halfvec hnsw index.
do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'policy_chunks_embedding_idx'
      and (indexdef like '%USING ivfflat%' or indexdef like '%vector_cosine_ops%')
  ) then
    execute 'drop index if exists policy_chunks_embedding_idx';
  end if;
end$$;

create index if not exists policy_chunks_embedding_idx
  on policy_chunks using hnsw (embedding halfvec_cosine_ops);
create index if not exists policy_chunks_policy_id_idx on policy_chunks(policy_id);

-- ============================================================================
-- People (per-org employees + admins). Standalone mode uses password_hash;
-- HRMS Tile mode leaves it null and trusts an external launch.
-- ============================================================================

create table if not exists org_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  name text,
  password_hash text,
  must_reset_password boolean not null default true,
  role text not null default 'employee' check (role in ('employee', 'admin')),
  status text not null default 'draft' check (status in ('draft', 'invited', 'active', 'disabled')),
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, email)
);

alter table org_people
  add column if not exists password_hash text,
  add column if not exists must_reset_password boolean not null default true;

create index if not exists org_people_company_idx on org_people(company_id);

-- ============================================================================
-- Per-org SMTP credentials + invite-email draft.
-- ============================================================================

-- ============================================================================
-- Magic-link sign-in tokens. Replaces password-based auth for employees and
-- org admins. Tokens are single-use, time-bound, and browser-bound: the
-- request stores a `pending_login` cookie, and the click is rejected if the
-- cookie doesn't match.
-- ============================================================================

create table if not exists magic_tokens (
  token text primary key,                 -- random 64-char URL-safe string
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  -- 'invite' (admin-issued, 7-day expiry) vs 'recovery' (user-requested, 15-min expiry).
  kind text not null check (kind in ('invite', 'recovery')),
  browser_id text not null,               -- ties the token to the device that requested it
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists magic_tokens_email_idx on magic_tokens(email);
create index if not exists magic_tokens_company_idx on magic_tokens(company_id);

-- Per-user daily chat counter. Keyed by user_id + day so the row count
-- naturally bounds at active_users * retention. Used to enforce the
-- free-tier-friendly 20-chats/user/day cap.
create table if not exists chat_usage (
  user_id text not null,
  day date not null,
  count int not null default 0,
  primary key (user_id, day)
);

create index if not exists chat_usage_day_idx on chat_usage(day);

-- Atomic upsert-and-increment to avoid races when two concurrent chat calls
-- from the same user land in the same millisecond. Returns the new count.
create or replace function increment_chat_usage(p_user_id text, p_day date)
returns int
language plpgsql as $$
declare
  new_count int;
begin
  insert into chat_usage (user_id, day, count)
  values (p_user_id, p_day, 1)
  on conflict (user_id, day) do update
    set count = chat_usage.count + 1
  returning count into new_count;
  return new_count;
end;
$$;

create table if not exists org_smtp_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  host text,
  port int,
  username text,
  password text,
  from_email text,
  from_name text,
  updated_at timestamptz not null default now()
);

create table if not exists org_email_drafts (
  company_id uuid primary key references companies(id) on delete cascade,
  subject text not null default 'You have been invited to the policy portal',
  body text not null default 'Hello {{name}}, you have been added to the {{organization}} policy portal.',
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Per-org HRMS iframe launch configuration.
-- ============================================================================

create table if not exists org_hrms_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  enabled boolean not null default false,
  allowed_origin text,
  launch_secret text,
  last_rotated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table org_hrms_settings
  add column if not exists enabled boolean not null default false,
  add column if not exists allowed_origin text,
  add column if not exists launch_secret text,
  add column if not exists last_rotated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- ============================================================================
-- pgvector similarity helper used by /api/chat.
-- ============================================================================

-- Drop the old signature (vector(3072)) if present — CREATE OR REPLACE can't
-- change parameter types, and a function with the old signature would still
-- be resolved by PostgREST callers.
drop function if exists match_policy_chunks(vector, int, uuid);

create or replace function match_policy_chunks(
  query_embedding halfvec(3072),
  match_count int,
  filter_company uuid
)
returns table (
  id uuid,
  policy_id uuid,
  chunk_text text,
  similarity float
)
language sql stable as $$
  select
    policy_chunks.id,
    policy_chunks.policy_id,
    policy_chunks.chunk_text,
    1 - (policy_chunks.embedding <=> query_embedding) as similarity
  from policy_chunks
  where policy_chunks.company_id = filter_company
  order by policy_chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- Hybrid retrieval: pgvector cosine + Postgres full-text rank, fused via
-- reciprocal rank fusion (RRF). Catches exact-token matches (policy
-- numbers, names, acronyms) that pure vector search misses.
drop function if exists match_policy_chunks_hybrid(halfvec, text, int, uuid);

create or replace function match_policy_chunks_hybrid(
  query_embedding halfvec(3072),
  query_text text,
  match_count int,
  filter_company uuid
)
returns table (
  id uuid,
  policy_id uuid,
  chunk_text text,
  similarity float,
  hybrid_score float
)
language sql stable as $$
  with vector_hits as (
    select
      policy_chunks.id,
      policy_chunks.policy_id,
      policy_chunks.chunk_text,
      1 - (policy_chunks.embedding <=> query_embedding) as similarity,
      row_number() over (order by policy_chunks.embedding <=> query_embedding) as v_rank
    from policy_chunks
    where policy_chunks.company_id = filter_company
    order by policy_chunks.embedding <=> query_embedding
    limit match_count * 2
  ),
  text_hits as (
    select
      policy_chunks.id,
      row_number() over (
        order by ts_rank(to_tsvector('english', policy_chunks.chunk_text), plainto_tsquery('english', query_text)) desc
      ) as t_rank
    from policy_chunks
    where policy_chunks.company_id = filter_company
      and to_tsvector('english', policy_chunks.chunk_text) @@ plainto_tsquery('english', query_text)
    limit match_count * 2
  )
  select
    v.id,
    v.policy_id,
    v.chunk_text,
    v.similarity,
    -- RRF with k=60 (standard); vector and text contribute independently
    (1.0 / (60 + v.v_rank))::float + coalesce(1.0 / (60 + t.t_rank), 0)::float as hybrid_score
  from vector_hits v
  left join text_hits t on t.id = v.id
  order by hybrid_score desc
  limit match_count;
$$;
