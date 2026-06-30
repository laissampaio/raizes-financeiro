-- Schema do banco de sync Raízes DS. Rodar uma vez no SQL Editor do Supabase
-- (Project > SQL Editor > New query) antes da primeira execução do sync.py.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Dimensões
-- ---------------------------------------------------------------------------

create table if not exists dim_projeto (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  status text,
  data_inicio date,
  data_fim date,
  orcamento_total numeric,
  categoria_power_bi text,
  revisado boolean,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists dim_categoria (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  detalhamento text not null default '',
  detalhamento_p text not null default '',
  unique (categoria, detalhamento, detalhamento_p)
);

create table if not exists dim_pessoa (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  tipo text
);

create table if not exists dim_data (
  data date primary key,
  ano int not null,
  mes int not null,
  trimestre int not null,
  mes_nome text not null,
  semestre int not null
);

create table if not exists dim_aliquota (
  id uuid primary key default gen_random_uuid(),
  ano int not null,
  mes int not null,
  aliquota_pct numeric,
  unique (ano, mes)
);

-- ---------------------------------------------------------------------------
-- Fatos
-- ---------------------------------------------------------------------------

create table if not exists fact_lancamentos (
  id uuid primary key default gen_random_uuid(),
  data date references dim_data (data),
  projeto_id uuid references dim_projeto (id),
  categoria_id uuid references dim_categoria (id),
  pessoa_id uuid references dim_pessoa (id),
  tipo_movimento text,
  descricao text,
  credito numeric,
  debito numeric,
  saldo numeric,
  pertence_a_mim boolean,
  tipo_deslocamento text,
  km numeric,
  origem text,
  destino text,
  trecho int,
  sem_imposto boolean,
  obs text,
  obs_2 text,
  local text,
  criado_em timestamptz not null default now()
);

create table if not exists fact_orcamento_linhas (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid references dim_projeto (id),
  categoria_id uuid references dim_categoria (id),
  qtd_dias numeric,
  qtd_8h numeric,
  valor_unitario numeric,
  valor_total numeric,
  obs1 text,
  obs2 text,
  criado_em timestamptz not null default now()
);

create table if not exists fact_fluxo_previsto (
  id uuid primary key default gen_random_uuid(),
  data date references dim_data (data),
  projeto_id uuid references dim_projeto (id),
  ordem_fluxo int,
  categoria_1 text,
  categoria_2 text,
  valor numeric,
  criado_em timestamptz not null default now()
);

create table if not exists fact_aplicacao (
  id uuid primary key default gen_random_uuid(),
  data date unique references dim_data (data),
  entrada numeric,
  saida numeric,
  saldo_final numeric,
  rendimento numeric,
  criado_em timestamptz not null default now()
);

create index if not exists idx_fact_lancamentos_data on fact_lancamentos (data);
create index if not exists idx_fact_lancamentos_projeto on fact_lancamentos (projeto_id);
create index if not exists idx_fact_fluxo_previsto_data on fact_fluxo_previsto (data);
create index if not exists idx_fact_orcamento_projeto on fact_orcamento_linhas (projeto_id);

-- Tabelas criadas via SQL Editor não recebem GRANT automático para os
-- roles do PostgREST (a UI do Supabase faz isso por trás dos panos quando
-- a tabela é criada pelo Table Editor). sync.py usa a service_role key,
-- então precisa de acesso explícito de leitura/escrita.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- A planilha "Impostos" tem meses sem alíquota lançada ainda; a coluna
-- precisa aceitar null (o create table acima já não marca not null, mas
-- isso corrige bancos onde a tabela foi criada antes dessa revisão).
alter table dim_aliquota alter column aliquota_pct drop not null;

-- sync.py faz upsert on_conflict=data em fact_aplicacao, o que exige uma
-- constraint unique nessa coluna (corrige bancos onde a tabela foi criada
-- antes dessa revisão, sem a constraint).
alter table fact_aplicacao drop constraint if exists fact_aplicacao_data_key;
alter table fact_aplicacao add constraint fact_aplicacao_data_key unique (data);

-- aliquota_pct guarda o percentual já multiplicado (ex.: 14.05, não 0.1405);
-- numeric sem precisão fixa evita overflow em bancos onde a coluna foi
-- criada com numeric(5,4) (que só aceita |valor| < 10).
alter table dim_aliquota alter column aliquota_pct type numeric;

-- fact_orcamento_linhas.projeto_id foi criada NOT NULL em alguns ambientes
-- (ex.: via Supabase Table Editor), mas o schema pretende aceitar null para
-- linhas de orçamento cujo projeto ainda não está na lista mestra.
alter table fact_orcamento_linhas alter column projeto_id drop not null;
