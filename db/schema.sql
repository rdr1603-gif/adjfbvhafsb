-- PadelCoach Pro - esquema de datos sincronizados
-- Fuente unica de verdad. Un registro por fila, con id estable generado por el
-- cliente, version (updated_at) para resolver conflictos y borrado logico.

create schema if not exists padelcoach;

create table if not exists padelcoach.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  email_key     text not null unique,
  name          text not null default '',
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Colecciones sincronizables. El perfil del profesor se guarda como un registro
-- unico con collection='settings' e id='profile'.
create table if not exists padelcoach.records (
  user_id    uuid    not null references padelcoach.users(id) on delete cascade,
  collection text    not null,
  id         text    not null,
  data       jsonb   not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, collection, id),
  constraint records_collection_check check (
    collection in ('students', 'cycles', 'classes', 'recurrences', 'payments', 'settings')
  )
);

-- Consulta de sincronizacion: solo lo que cambio despues del cursor.
create index if not exists records_pull_idx
  on padelcoach.records (user_id, updated_at);
