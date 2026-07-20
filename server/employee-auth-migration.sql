-- Standalone employee password-login migration.
-- Run this once in the Supabase SQL Editor before using employee code login.

alter table org_people
  add column if not exists employee_code text,
  add column if not exists password_hash text,
  add column if not exists must_reset_password boolean not null default true;

create unique index if not exists org_people_company_employee_code_uq
  on org_people(company_id, employee_code)
  where employee_code is not null and employee_code <> '';

create table if not exists password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  person_id uuid not null references org_people(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_otps_person_idx on password_reset_otps(person_id);
create index if not exists password_reset_otps_company_idx on password_reset_otps(company_id);
