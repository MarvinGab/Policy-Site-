-- Phase 1: per-org access tokens.
-- Run this once in Supabase SQL Editor.

alter table companies
  add column if not exists access_token text;

create unique index if not exists companies_access_token_uq on companies(access_token);
