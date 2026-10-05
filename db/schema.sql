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

-- Acceso por PIN. El acceso es un PIN corto, asi que la columna email queda
-- sin uso: se conservan por compatibilidad con cuentas ya creadas y para que
-- las pruebas siga limpiandose por correo.
--
-- pin_key = HMAC(SESSION_SECRET, "pin:"<pin>) -> busqueda con indice sin
--           guardar el PIN en claro. Un volcado de la base no permite deducirlo.
-- pin_hash = scrypt con sal propia -> verificacion y segunda barrera.
alter table padelcoach.users add column if not exists pin_key text;
alter table padelcoach.users add column if not exists pin_hash text;

-- Las cuentas creadas desde ahora solo tienen PIN, asi que correo y hash de
-- contrasena pasan a ser opcionales. Los NOT NULL sobraBAN: una cuenta sin
-- correo tiene que poder existir.
alter table padelcoach.users alter column email drop not null;
alter table padelcoach.users alter column email_key drop not null;
alter table padelcoach.users alter column password_hash drop not null;

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

-- Limite de intentos de acceso. En Vercel cada instancia tiene su propia
-- memoria, asi que un contador en memoria no frena a nadie: el contador vive
-- en la base y se incrementa de forma atomica.
create table if not exists padelcoach.login_attempts (
  bucket    text primary key,
  hits      integer     not null default 1,
  reset_at  timestamptz not null
);

create index if not exists login_attempts_reset_idx
  on padelcoach.login_attempts (reset_at);

-- "create table if not exists" no hace nada si la tabla ya existe: nunca agrega
-- constraints. Por eso el UNIQUE de email_key se agrega aca, de forma
-- idempotente. Sin el, se pueden crear varias cuentas con el mismo correo y el
-- login empieza a fallar porque podria validar contra la fila equivocada.
-- Falla a proposito si hay duplicados: primero hay que resolverlos a mano.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'padelcoach.users'::regclass
      and contype = 'u'
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'padelcoach.users'::regclass and attname = 'email_key')
      ]::smallint[]
  ) then
    alter table padelcoach.users add constraint users_email_key_key unique (email_key);
  end if;
end $$;

-- Mismo motivo: la FK de records a users y el CHECK de collection tampoco
-- estan garantizados en bases creadas antes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'padelcoach.records'::regclass and contype = 'f'
  ) then
    alter table padelcoach.records
      add constraint records_user_id_fkey foreign key (user_id)
      references padelcoach.users(id) on delete cascade;
  end if;
end $$;

-- El acceso es por PIN, no por correo. Dos cuentas no pueden compartir PIN.
-- Indice parcial porque las cuentas viejas todavia no lo tienen.
create unique index if not exists users_pin_key_key
  on padelcoach.users (pin_key)
  where pin_key is not null;