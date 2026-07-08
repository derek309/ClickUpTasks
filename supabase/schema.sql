-- ClickUpTasks — Phase 1 schema
-- Run this once in your Supabase project: SQL Editor → paste → Run.
-- RLS is intentionally left OFF for now; row-level security + roles land in
-- Phase 1b when we add VA logins. The app auto-seeds demo data on first load.

create table if not exists clients (
  id text primary key,
  name text not null,
  color text not null default '#a855f7',
  ghl_location_id text,
  created_at timestamptz default now()
);

create table if not exists contacts (
  id text primary key,
  client_id text references clients(id) on delete cascade,
  name text not null,
  email text,
  ghl_contact_id text
);

create table if not exists projects (
  id text primary key,
  client_id text references clients(id) on delete cascade,
  name text not null,
  description text default ''
);

create table if not exists tasks (
  id text primary key,
  project_id text references projects(id) on delete cascade,
  client_id text references clients(id) on delete cascade,
  title text not null,
  description text default '',
  status text default 'todo',
  priority text default 'none',
  assignee_id text,
  contact_id text,
  due text,
  recurrence text default 'none',
  ghl_task_id text,
  label_ids jsonb default '[]',
  subtasks jsonb default '[]',
  attachments jsonb default '[]',
  comments jsonb default '[]',
  created_at timestamptz default now()
);

create table if not exists notifications (
  id text primary key,
  recipient_id text,
  text text,
  task_id text,
  at text,
  read boolean default false,
  created_at timestamptz default now()
);
