create table if not exists public.org_email_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  subject text not null,
  body text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_email_templates_company_idx
  on public.org_email_templates(company_id);
create unique index if not exists org_email_templates_one_default_uq
  on public.org_email_templates(company_id)
  where is_default = true;
