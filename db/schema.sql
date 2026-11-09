-- Mesas Multifuncionales · Programa de vendedores afiliados
-- Ejecutar UNA vez en Supabase → SQL Editor. Es seguro volver a correrlo (usa IF NOT EXISTS).

create table if not exists vendedores (
  id            serial primary key,
  nombre        text not null,
  email         text not null,
  celular       text not null,
  password_hash text not null,
  codigo        text not null,
  creado_en     timestamptz not null default now()
);
create unique index if not exists vendedores_email_uq   on vendedores (lower(email));
create unique index if not exists vendedores_celular_uq on vendedores (celular);
create unique index if not exists vendedores_codigo_uq  on vendedores (codigo);

-- Clientes (navegadores) que entraron con el enlace de un vendedor
create table if not exists visitas (
  id          bigserial primary key,
  vendedor_id int not null references vendedores(id) on delete cascade,
  visitor_id  text not null,
  creado_en   timestamptz not null default now(),
  unique (vendedor_id, visitor_id)
);
create index if not exists visitas_visitor_idx on visitas (visitor_id, creado_en);

create table if not exists pedidos (
  id               serial primary key,
  cliente_nombre   text not null,
  cliente_celular  text not null,
  ciudad           text not null,
  direccion        text not null,
  puestos          smallint not null check (puestos in (4, 6)),
  color            text not null,
  cantidad         smallint not null check (cantidad between 1 and 10),
  notas            text,
  precio_unitario  int not null,
  total            int not null,
  vendedor_id      int references vendedores(id),
  estado           text not null default 'nuevo' check (estado in ('nuevo','entregado','cancelado')),
  creado_en        timestamptz not null default now(),
  entregado_en     timestamptz
);
create index if not exists pedidos_vendedor_idx on pedidos (vendedor_id);
create index if not exists pedidos_estado_idx   on pedidos (estado);

create table if not exists solicitudes_pago (
  id              serial primary key,
  vendedor_id     int not null references vendedores(id),
  monto           int not null check (monto > 0),
  metodo          text not null,
  cuenta          text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada','pagada')),
  nota_admin      text,
  referencia_pago text,
  creado_en       timestamptz not null default now(),
  resuelto_en     timestamptz,
  pagado_en       timestamptz
);
create index if not exists solicitudes_vendedor_idx on solicitudes_pago (vendedor_id);

-- Una comisión por pedido (UNIQUE evita duplicarla)
create table if not exists comisiones (
  id           serial primary key,
  pedido_id    int not null unique references pedidos(id),
  vendedor_id  int not null references vendedores(id),
  monto        int not null check (monto > 0),
  estado       text not null default 'pendiente' check (estado in ('pendiente','solicitada','pagada','cancelada')),
  solicitud_id int references solicitudes_pago(id),
  creado_en    timestamptz not null default now()
);
create index if not exists comisiones_vendedor_idx on comisiones (vendedor_id, estado);

-- Control de intentos (anti-spam / fuerza bruta)
create table if not exists intentos (
  id        bigserial primary key,
  clave     text not null,
  creado_en timestamptz not null default now()
);
create index if not exists intentos_idx on intentos (clave, creado_en);

-- SEGURIDAD: bloquea el acceso público directo de Supabase (API anon) a estas tablas.
-- La tienda accede con su conexión privada del servidor, que no se ve afectada.
alter table vendedores        enable row level security;
alter table visitas           enable row level security;
alter table pedidos           enable row level security;
alter table solicitudes_pago  enable row level security;
alter table comisiones        enable row level security;
alter table intentos          enable row level security;
