-- PARTE 12: ALERTA FÁBRICA (antes "Ocorrências").
-- • Fábricas ficam no servidor e valem para todos (cadastra/edita quem tem o acesso; apaga só Controle/admin).
-- • E-mails fixos em cópia (CC) ficam numa configuração que só o administrador muda.
-- • Cada alerta enviado fica registrado (protocolo) e as fotos/vídeos ficam no armazenamento (bucket "evidencias").
-- Rode no SQL Editor depois das partes anteriores. Pode rodar de novo sem problema.

-- Quem pode usar: administrador ou quem tem o acesso "ocorrencias".
create or replace function public.pode_alerta() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin or 'ocorrencias' = any(acessos) from public.perfis where id = auth.uid()), false)
$$;

-- ---------- tabelas ----------
create table if not exists public.fabricas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(trim(nome)) between 2 and 80),
  emails        text[] not null check (cardinality(emails) between 1 and 8),
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists fabricas_nome_unico on public.fabricas (lower(trim(nome)));

create table if not exists public.alerta_config (
  id int primary key default 1 check (id = 1),
  cc text[] not null default '{}' check (cardinality(cc) <= 6),
  atualizado_em timestamptz not null default now()
);
insert into public.alerta_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.alertas (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  criado_por    text not null,
  fabrica_id    uuid,
  fabrica_nome  text not null,
  nf            text,
  motorista     text,
  placa_carreta text,
  placa_cavalo  text,
  descricao     text not null check (length(descricao) between 1 and 4000),
  evidencias    jsonb not null default '[]'::jsonb
);
create index if not exists alertas_criado on public.alertas (criado_em desc);

alter table public.fabricas      enable row level security;
alter table public.alerta_config enable row level security;
alter table public.alertas       enable row level security;
revoke all on public.fabricas, public.alerta_config, public.alertas from anon, authenticated;

-- ---------- validação de e-mails ----------
create or replace function public._alerta_emails(p text[], p_max int) returns text[]
language plpgsql immutable as $$
declare e text; r text[] := '{}';
begin
  foreach e in array coalesce(p, '{}') loop
    e := lower(trim(e));
    if e = '' then continue; end if;
    if e !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' or length(e) > 120 then raise exception 'E-mail inválido: %', e; end if;
    if not (e = any(r)) then r := r || e; end if;
  end loop;
  if coalesce(array_length(r, 1), 0) > p_max then raise exception 'No máximo % e-mails.', p_max; end if;
  return r;
end $$;

-- ---------- fábricas ----------
create or replace function public.fab_listar() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_alerta() then raise exception 'Seu login não tem acesso ao Alerta Fábrica.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'emails', to_jsonb(emails)) order by lower(nome)) from public.fabricas), '[]'::jsonb);
end $$;

-- Cria (p_id nulo) ou corrige (p_id) uma fábrica.
create or replace function public.fab_salvar(p_id uuid, p_nome text, p_emails text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me text := public.minha_matricula(); v_nome text := trim(coalesce(p_nome, '')); v_em text[]; v_id uuid;
begin
  if not public.pode_alerta() then raise exception 'Seu login não tem acesso ao Alerta Fábrica.'; end if;
  if length(v_nome) < 2 then raise exception 'Informe o nome da fábrica.'; end if;
  v_em := public._alerta_emails(p_emails, 8);
  if coalesce(array_length(v_em, 1), 0) = 0 then raise exception 'Informe pelo menos um e-mail.'; end if;
  if exists (select 1 from public.fabricas where lower(trim(nome)) = lower(v_nome) and id is distinct from p_id) then
    raise exception 'Já existe uma fábrica com o nome "%".', v_nome;
  end if;
  if p_id is null then
    insert into public.fabricas (nome, emails, criado_por) values (v_nome, v_em, v_me) returning id into v_id;
  else
    update public.fabricas set nome = v_nome, emails = v_em, atualizado_em = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Fábrica não encontrada (outra pessoa pode ter apagado).'; end if;
  end if;
  return jsonb_build_object('id', v_id, 'nome', v_nome, 'emails', to_jsonb(v_em));
end $$;

-- Só Controle ou administrador apagam.
create or replace function public.fab_apagar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_controle() then raise exception 'Só o Controle ou o administrador podem apagar fábricas.'; end if;
  delete from public.fabricas where id = p_id;
end $$;

-- Traz para o servidor as fábricas que estavam só no celular: [{nome, email}] (e-mail pode ter vários, separados por vírgula).
create or replace function public.fab_importar(p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me text := public.minha_matricula(); e jsonb; v_nome text; v_em text[]; v_novas int := 0; v_ja int := 0; v_ruins int := 0;
begin
  if not public.pode_alerta() then raise exception 'Seu login não tem acesso ao Alerta Fábrica.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 300 then raise exception 'Lista inválida.'; end if;
  for e in select * from jsonb_array_elements(p_itens) loop
    begin
      v_nome := trim(coalesce(e->>'nome', ''));
      v_em := public._alerta_emails(regexp_split_to_array(coalesce(e->>'email', ''), '[;,\s]+'), 8);
      if length(v_nome) < 2 or coalesce(array_length(v_em, 1), 0) = 0 then v_ruins := v_ruins + 1; continue; end if;
      if exists (select 1 from public.fabricas where lower(trim(nome)) = lower(v_nome)) then v_ja := v_ja + 1; continue; end if;
      insert into public.fabricas (nome, emails, criado_por) values (v_nome, v_em, v_me);
      v_novas := v_novas + 1;
    exception when others then v_ruins := v_ruins + 1;
    end;
  end loop;
  return jsonb_build_object('novas', v_novas, 'ja_existiam', v_ja, 'ignoradas', v_ruins);
end $$;

-- ---------- e-mails em cópia (CC) ----------
create or replace function public.alerta_cc_ler() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_alerta() then raise exception 'Seu login não tem acesso ao Alerta Fábrica.'; end if;
  return to_jsonb((select cc from public.alerta_config where id = 1));
end $$;

create or replace function public.alerta_cc_salvar(p_cc text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if not public.is_admin() then raise exception 'Só o administrador muda os e-mails em cópia.'; end if;
  v := public._alerta_emails(p_cc, 6);
  update public.alerta_config set cc = v, atualizado_em = now() where id = 1;
  return to_jsonb(v);
end $$;

-- ---------- registro do alerta ----------
-- Guarda o alerta, gera o protocolo e devolve para quem enviar (fábrica) e quem vai em cópia, já conferidos no servidor.
create or replace function public.alerta_registrar(p_fabrica uuid, p_nf text, p_motorista text, p_carreta text, p_cavalo text, p_desc text, p_evidencias jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me text := public.minha_matricula(); v_fab public.fabricas; v_id bigint; v_cc text[]; v_ev jsonb := '[]'::jsonb; x jsonb; v_nome text;
begin
  if v_me is null then raise exception 'Faça login de novo.'; end if;
  if not public.pode_alerta() then raise exception 'Seu login não tem acesso ao Alerta Fábrica.'; end if;
  select * into v_fab from public.fabricas where id = p_fabrica;
  if v_fab.id is null then raise exception 'Fábrica não encontrada. Atualize a lista.'; end if;
  if length(trim(coalesce(p_desc, ''))) = 0 then raise exception 'Descreva a ocorrência.'; end if;
  if p_evidencias is not null and jsonb_typeof(p_evidencias) = 'array' then
    for x in select * from jsonb_array_elements(p_evidencias) loop
      if jsonb_typeof(x) = 'string' and length(x #>> '{}') between 5 and 300 then v_ev := v_ev || x; end if;
      exit when jsonb_array_length(v_ev) >= 30;
    end loop;
  end if;
  insert into public.alertas (criado_por, fabrica_id, fabrica_nome, nf, motorista, placa_carreta, placa_cavalo, descricao, evidencias)
  values (v_me, v_fab.id, v_fab.nome, left(trim(coalesce(p_nf, '')), 30), left(trim(coalesce(p_motorista, '')), 80),
          left(upper(trim(coalesce(p_carreta, ''))), 10), left(upper(trim(coalesce(p_cavalo, ''))), 10), left(trim(p_desc), 4000), v_ev)
  returning id into v_id;
  select cc into v_cc from public.alerta_config where id = 1;
  select nome into v_nome from public.perfis where matricula = v_me;
  return jsonb_build_object('id', v_id, 'protocolo', 'AF-' || to_char(now(), 'YYMM') || '-' || lpad(v_id::text, 5, '0'),
                            'para', to_jsonb(v_fab.emails), 'cc', to_jsonb(coalesce(v_cc, '{}')), 'fabrica', v_fab.nome, 'por', v_nome, 'matricula', v_me);
end $$;

-- Últimos alertas (Controle e administrador).
create or replace function public.alerta_historico() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_controle() then raise exception 'Seu login não tem acesso ao Controle.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'criado_em', a.criado_em, 'fabrica', a.fabrica_nome, 'nf', a.nf, 'por', p.nome,
                     'descricao', a.descricao, 'evidencias', jsonb_array_length(a.evidencias)) order by a.id desc)
                     from (select * from public.alertas order by id desc limit 40) a left join public.perfis p on p.matricula = a.criado_por), '[]'::jsonb);
end $$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_listar','fab_salvar','fab_apagar','fab_importar','alerta_cc_ler','alerta_cc_salvar','alerta_registrar','alerta_historico') loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  revoke all on function public._alerta_emails(text[], int) from public, anon, authenticated;
end $$;

-- ---------- armazenamento das fotos e vídeos ----------
-- Bucket público (os links do e-mail abrem para a fábrica sem login). Os nomes são aleatórios, então não dá para adivinhar.
-- Só quem tem acesso ao Alerta Fábrica consegue enviar arquivos.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('evidencias', 'evidencias', true, 20971520, array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm','video/3gpp'])
    on conflict (id) do update set public = true, file_size_limit = 20971520,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm','video/3gpp'];
    drop policy if exists "alerta_envia_evidencias" on storage.objects;
    create policy "alerta_envia_evidencias" on storage.objects for insert to authenticated
      with check (bucket_id = 'evidencias' and public.pode_alerta());
  end if;
end $$;
