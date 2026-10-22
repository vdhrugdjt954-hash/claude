-- 一百天祝福页：Supabase 建表脚本
-- 用法：Supabase 控制台 → SQL Editor → 整段粘进去 → 改最下面两处 → Run
-- 前端只拿得到下面这几个函数，碰不到表本身：
--   来宾：submit_wish 写一封（可以带一幅画）、wish_status 看有几封、public_wishes 读大家写的
--   你：admin_* 系列，要口令

create extension if not exists pgcrypto with schema extensions;

-- ---------- 表 ----------
create table if not exists public.wishes (
  id          bigserial primary key,
  nickname    text,                               -- 空 = 不署名
  question    text not null,
  body        text not null,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  pinned      boolean not null default false,     -- 你自己那封，排第一
  strokes     jsonb,                              -- 随信附的小画，没画就是空
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists wishes_ip_time on public.wishes (ip_hash, created_at);
-- 跑过旧版脚本的话，补上画的那一列
alter table public.wishes add column if not exists strokes jsonb;

create table if not exists public.wish_settings (
  id           int primary key default 1 check (id = 1),
  auto_approve boolean not null default true,     -- true：写完直接显示；false：你审过才显示
  admin_hash   text not null                      -- 管理口令（只存哈希）
);
-- 跑过旧版脚本的话，顺手把表结构升级
alter table public.wish_settings add column if not exists auto_approve boolean not null default true;
alter table public.wish_settings drop column if exists unseal_at;
drop function if exists public.admin_set_unseal(text, timestamptz);

-- 表全部锁死，前端的匿名 key 直接读写表一律被拒
alter table public.wishes        enable row level security;
alter table public.wish_settings enable row level security;
revoke all on public.wishes, public.wish_settings from anon, authenticated;
revoke all on sequence public.wishes_id_seq from anon, authenticated;

-- ---------- 内部小工具（不对外） ----------
create or replace function public._wish_check_admin(p_pass text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare h text;
begin
  select admin_hash into h from wish_settings where id = 1;
  if h is null or p_pass is null or crypt(p_pass, h) <> h then
    perform pg_sleep(1);                           -- 拖慢乱猜口令
    raise exception 'bad_password';
  end if;
end $$;

create or replace function public._wish_client_hash()
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare hdr json; ip text;
begin
  begin
    hdr := current_setting('request.headers', true)::json;
  exception when others then hdr := null;
  end;
  ip := coalesce(
    split_part(hdr ->> 'x-forwarded-for', ',', 1),
    hdr ->> 'cf-connecting-ip',
    'unknown');
  -- 不存原始 IP，只存哈希，够限流用
  return encode(digest('wish-salt:' || trim(ip), 'sha256'), 'hex');
end $$;

-- 检查随信小画的格式，不合格直接拒
-- 画布是 1000×1000 的方形，左上角 (0,0)。一幅画 = 一串笔画：
-- [{"color":"#e48fa3","width":8,"points":[[500,300],[420,220]],"opacity":0.9,"fill":false}, ...]
--   color 必填 #hex；width 1~60；points 至少 1 个点，坐标 0~1000
--   opacity 可选 0.05~1；fill 可选 true/false（true = 把这一笔围起来涂满）
create or replace function public._wish_check_strokes(p jsonb)
returns void language plpgsql immutable
set search_path = public as $$
declare st jsonb; pt jsonb; total int := 0; v numeric;
begin
  if jsonb_typeof(p) <> 'array' then raise exception 'bad_strokes'; end if;
  if jsonb_array_length(p) > 400 or octet_length(p::text) > 200000 then
    raise exception 'drawing_too_big';
  end if;
  for st in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(st) <> 'object' then raise exception 'bad_strokes'; end if;
    if coalesce(st ->> 'color', '') !~ '^#[0-9a-fA-F]{3,8}$' then raise exception 'bad_strokes'; end if;
    if jsonb_typeof(st -> 'width') <> 'number' then raise exception 'bad_strokes'; end if;
    v := (st ->> 'width')::numeric;
    if v < 1 or v > 60 then raise exception 'bad_strokes'; end if;
    if st ? 'opacity' then
      if jsonb_typeof(st -> 'opacity') <> 'number' then raise exception 'bad_strokes'; end if;
      v := (st ->> 'opacity')::numeric;
      if v < 0.05 or v > 1 then raise exception 'bad_strokes'; end if;
    end if;
    if st ? 'fill' and jsonb_typeof(st -> 'fill') <> 'boolean' then raise exception 'bad_strokes'; end if;
    if jsonb_typeof(st -> 'points') <> 'array' or jsonb_array_length(st -> 'points') < 1 then
      raise exception 'bad_strokes';
    end if;
    for pt in select * from jsonb_array_elements(st -> 'points') loop
      if jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) <> 2
         or jsonb_typeof(pt -> 0) <> 'number' or jsonb_typeof(pt -> 1) <> 'number' then
        raise exception 'bad_strokes';
      end if;
      if (pt ->> 0)::numeric not between 0 and 1000
         or (pt ->> 1)::numeric not between 0 and 1000 then
        raise exception 'bad_strokes';
      end if;
      total := total + 1;
    end loop;
  end loop;
  if total > 12000 then raise exception 'drawing_too_big'; end if;
end $$;

-- ---------- 来宾：写一封 ----------
drop function if exists public.submit_wish(text, text, text);
create or replace function public.submit_wish(p_nickname text, p_question text, p_body text, p_strokes jsonb default null)
returns json language plpgsql security definer
set search_path = public, extensions as $$
declare
  n text := nullif(trim(coalesce(p_nickname, '')), '');
  q text := trim(coalesce(p_question, ''));
  b text := trim(coalesce(p_body, ''));
  h text := _wish_client_hash();
  row wishes;
begin
  if char_length(b) < 1   then raise exception 'empty_body'; end if;
  if char_length(b) > 150 then raise exception 'body_too_long'; end if;
  if n is not null and char_length(n) > 20 then raise exception 'name_too_long'; end if;
  if char_length(q) > 60 then raise exception 'bad_question'; end if;   -- 可以不填
  if p_strokes is not null and p_strokes <> '[]'::jsonb then perform _wish_check_strokes(p_strokes); end if;

  -- 同一个人 10 分钟最多 3 封；整个页面 10 分钟最多 60 封
  if (select count(*) from wishes
      where ip_hash = h and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'too_many';
  end if;
  if (select count(*) from wishes
      where created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'too_many_global';
  end if;

  insert into wishes (nickname, question, body, strokes, ip_hash, status)
  values (n, q, b, nullif(p_strokes, '[]'::jsonb), h,
          case when (select auto_approve from wish_settings where id = 1)
               then 'approved' else 'pending' end)
  returning * into row;

  return json_build_object('id', row.id, 'created_at', row.created_at, 'status', row.status);
end $$;

-- ---------- 来宾：有几封、要不要审 ----------
drop function if exists public.wish_status();
create or replace function public.wish_status()
returns json language sql security definer stable
set search_path = public as $$
  select json_build_object(
    'count',        (select count(*) from wishes where status = 'approved'),
    'auto_approve', s.auto_approve)
  from wish_settings s where s.id = 1;
$$;

-- ---------- 来宾：读大家写的（只读显示中的，置顶在前，新的在前） ----------
drop function if exists public.public_wishes();
create or replace function public.public_wishes()
returns table (nickname text, question text, body text, strokes jsonb, pinned boolean, created_at timestamptz)
language sql security definer stable
set search_path = public as $$
  select w.nickname, w.question, w.body, w.strokes, w.pinned, w.created_at
  from wishes w
  where w.status = 'approved'
  order by w.pinned desc, w.created_at desc
  limit 500;
$$;

-- ---------- 你：管理 ----------
create or replace function public.admin_list(p_pass text)
returns setof public.wishes language plpgsql security definer
set search_path = public as $$
begin
  perform _wish_check_admin(p_pass);
  return query select * from wishes order by pinned desc, created_at asc;
end $$;

create or replace function public.admin_set_status(p_pass text, p_id bigint, p_status text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  perform _wish_check_admin(p_pass);
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'bad_status'; end if;
  update wishes set status = p_status where id = p_id;
end $$;

create or replace function public.admin_delete(p_pass text, p_id bigint)
returns void language plpgsql security definer
set search_path = public as $$
begin
  perform _wish_check_admin(p_pass);
  delete from wishes where id = p_id;
end $$;

-- 你自己那第一封：直接通过、置顶
create or replace function public.admin_add_own(p_pass text, p_nickname text, p_question text, p_body text)
returns json language plpgsql security definer
set search_path = public as $$
declare row wishes;
begin
  perform _wish_check_admin(p_pass);
  if char_length(trim(coalesce(p_body, ''))) < 1 then raise exception 'empty_body'; end if;
  insert into wishes (nickname, question, body, status, pinned)
  values (nullif(trim(p_nickname), ''), trim(coalesce(p_question, '')), trim(p_body), 'approved', true)
  returning * into row;
  return json_build_object('id', row.id, 'created_at', row.created_at);
end $$;

-- 切换：写完直接显示 / 审过才显示
create or replace function public.admin_set_auto_approve(p_pass text, p_on boolean)
returns void language plpgsql security definer
set search_path = public as $$
begin
  perform _wish_check_admin(p_pass);
  update wish_settings set auto_approve = coalesce(p_on, true) where id = 1;
end $$;

-- ---------- 权限：只放出该放的函数 ----------
-- 只动这页自己的函数，不碰库里别的东西
revoke execute on function public._wish_check_admin(text)              from public, anon, authenticated;
revoke execute on function public._wish_client_hash()                  from public, anon, authenticated;
revoke execute on function public._wish_check_strokes(jsonb)           from public, anon, authenticated;
revoke execute on function public.submit_wish(text, text, text, jsonb)  from public;
revoke execute on function public.wish_status()                         from public;
revoke execute on function public.public_wishes()                       from public;
revoke execute on function public.admin_list(text)                      from public;
revoke execute on function public.admin_set_status(text, bigint, text)  from public;
revoke execute on function public.admin_delete(text, bigint)            from public;
revoke execute on function public.admin_add_own(text, text, text, text) from public;
revoke execute on function public.admin_set_auto_approve(text, boolean) from public;
grant execute on function public.submit_wish(text, text, text, jsonb)  to anon, authenticated;
grant execute on function public.wish_status()                         to anon, authenticated;
grant execute on function public.public_wishes()                       to anon, authenticated;
grant execute on function public.admin_list(text)                      to anon, authenticated;
grant execute on function public.admin_set_status(text, bigint, text)  to anon, authenticated;
grant execute on function public.admin_delete(text, bigint)            to anon, authenticated;
grant execute on function public.admin_add_own(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_set_auto_approve(text, boolean) to anon, authenticated;

-- ---------- 改这一处再运行 ----------
-- 管理口令，换成只有你知道的一串
insert into public.wish_settings (id, admin_hash)
values (1, extensions.crypt('改成你的管理口令', extensions.gen_salt('bf')))
on conflict (id) do update set admin_hash = excluded.admin_hash;
