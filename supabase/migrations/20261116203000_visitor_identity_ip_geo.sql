-- ============================================================
-- 访客身份：原始 IP + 精确地理 + 设备指纹
-- ============================================================
-- 背景：原来只存 SHA-256(ip+salt) 的前缀，只能判断「是不是同一个人」，
-- 判断不了「是谁」。这次按站点所有者的要求落库原始 IP 与 Vercel 提供的
-- 城市级经纬度，并顺带补齐机型、webview 宿主、网络制式、完整 referrer。
--
-- 代价必须记在这里：一旦写入原始 IP，站点「不存原始 IP」的承诺即失效。
-- 因此同时提供 prune_visitor_pii()，可用于定期清掉 IP 与坐标、只留哈希。
--
-- 兼容性：page_view_events / page_view_record 是 inon.space 与 world.inon.space
-- 共用的。这里只做「加列 + 加带默认值的参数」，world 侧一行代码都不用改；
-- 但必须 drop 旧签名再重建，否则两个签名都存在会变成重载，PostgREST 按
-- 参数名解析时无法唯一确定调用目标。
-- ============================================================

-- ---------- 1. 事件流：加访客身份列 ----------
alter table public.page_view_events
  add column if not exists ip            inet,
  add column if not exists geo_continent text  not null default '',
  add column if not exists geo_region    text  not null default '',
  add column if not exists geo_city      text  not null default '',
  add column if not exists geo_timezone  text  not null default '',
  add column if not exists geo_postal    text  not null default '',
  add column if not exists geo_lat       double precision,
  add column if not exists geo_lon       double precision,
  add column if not exists device_model  text  not null default '',
  add column if not exists webview       text  not null default '',
  add column if not exists network_type  text  not null default '',
  add column if not exists referrer_url  text  not null default '',
  add column if not exists dwell_ms      integer not null default 0;

comment on column public.page_view_events.ip is
  'Raw client IP (inet). Written only when the deployment is configured to collect it; prune with prune_visitor_pii().';
comment on column public.page_view_events.geo_lat is
  'IP-derived latitude from Vercel edge geo (city centroid, NOT GPS).';
comment on column public.page_view_events.device_model is
  'Device model code parsed from UA (e.g. M332BF); empty when unknown.';
comment on column public.page_view_events.webview is
  'Host app of an in-app browser: wechat / qq / alipay / dingtalk / weibo / douyin / '' for a real browser.';

create index if not exists page_view_events_ip_idx
  on public.page_view_events (ip, created_at desc);

-- ---------- 2. 聊天：独立的访客身份表 ----------
-- 为什么不直接往 chat_messages 加列：那张表对匿名开放了 select，而且加入了
-- realtime 广播。Supabase Realtime 推送的是整行数据，往表里加 ip 列等于向
-- 每一个访客公开其他人的 IP —— RLS 只能按行过滤，拦不住列。
-- 所以身份信息单独放一张 deny-all 的表，服务端用 secret key 读写。
create table if not exists public.chat_visitor_meta (
  message_id  uuid primary key references public.chat_messages(id) on delete cascade,
  created_at  timestamptz not null default timezone('utc'::text, now()),
  ip          inet,
  ip_hash     text not null default '',
  country     text not null default '',
  region      text not null default '',
  city        text not null default '',
  geo_lat     double precision,
  geo_lon     double precision,
  session_id  text not null default '',
  user_agent  text not null default ''
);

comment on table public.chat_visitor_meta is
  'Per-message visitor identity (raw IP, geo, UA). Deliberately kept out of chat_messages so realtime never broadcasts it.';

alter table public.chat_visitor_meta enable row level security;
-- 不建任何策略 => 匿名与 authenticated 默认拒绝，只有服务端 secret key 能读写

create index if not exists chat_visitor_meta_ip_idx
  on public.chat_visitor_meta (ip, created_at desc);

-- ---------- 3. 重载 page_view_record ----------
drop function if exists public.page_view_record(
  uuid, text, text, text, text, text, text, text, text, text, text, integer
);

create or replace function public.page_view_record(
  p_profile_id     uuid,
  p_event_name     text     default 'page_view',
  p_url_path       text     default '/',
  p_referrer       text     default '',
  p_country        text     default '',
  p_device_type    text     default '',
  p_browser        text     default '',
  p_os             text     default '',
  p_ip_hash        text     default '',
  p_session_id     text     default '',
  p_user_agent     text     default '',
  p_dwell_ms       integer  default 0,
  p_ip             text     default '',
  p_geo_continent  text     default '',
  p_geo_region     text     default '',
  p_geo_city       text     default '',
  p_geo_timezone   text     default '',
  p_geo_postal     text     default '',
  p_geo_lat        double precision default null,
  p_geo_lon        double precision default null,
  p_device_model   text     default '',
  p_webview        text     default '',
  p_network_type   text     default '',
  p_referrer_url   text     default ''
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id       bigint;
  v_ip             inet;
  v_today          date := (timezone('utc'::text, now()))::date;
  v_is_new_uv      boolean;
  v_is_new_session boolean;
  v_ref_domain     text;
  v_path_key       text;
  v_browser_key    text;
begin
  -- 非法 IP 字符串不该让整条事件丢失，落 null 即可
  if p_ip ~ '^[0-9A-Fa-f:.]+$' then
    begin
      v_ip := p_ip::inet;
    exception when others then
      v_ip := null;
    end;
  end if;

  -- 1) 写事件流
  insert into public.page_view_events (
    profile_id, stat_date, event_name, url_path, referrer,
    country, device_type, browser, os, ip_hash, session_id, user_agent,
    ip, geo_continent, geo_region, geo_city, geo_timezone, geo_postal,
    geo_lat, geo_lon, device_model, webview, network_type, referrer_url, dwell_ms
  ) values (
    p_profile_id, v_today, p_event_name, p_url_path, p_referrer,
    p_country, p_device_type, p_browser, p_os, p_ip_hash, p_session_id, p_user_agent,
    v_ip,
    left(coalesce(p_geo_continent, ''), 8),
    left(coalesce(p_geo_region, ''), 64),
    left(coalesce(p_geo_city, ''), 64),
    left(coalesce(p_geo_timezone, ''), 64),
    left(coalesce(p_geo_postal, ''), 16),
    p_geo_lat, p_geo_lon,
    left(coalesce(p_device_model, ''), 64),
    left(coalesce(p_webview, ''), 16),
    left(coalesce(p_network_type, ''), 8),
    left(coalesce(p_referrer_url, ''), 512),
    greatest(p_dwell_ms, 0)
  )
  returning id into v_event_id;

  -- 2) 仅 page_view 进入聚合统计；自定义事件只进事件流
  if p_event_name <> 'page_view' then
    return v_event_id;
  end if;

  -- 3) UV 去重：当日同 ip_hash 是否已出现过
  select not exists (
    select 1 from public.page_view_events e
    where e.profile_id = p_profile_id
      and e.stat_date  = v_today
      and e.event_name = 'page_view'
      and e.ip_hash    = p_ip_hash
      and e.id        <> v_event_id
  ) into v_is_new_uv;

  -- 4) Session 去重：当日同 session_id 是否已出现过（影响 bounce 计数）
  select not exists (
    select 1 from public.page_view_events e
    where e.profile_id = p_profile_id
      and e.stat_date  = v_today
      and e.event_name = 'page_view'
      and e.session_id = p_session_id
      and e.id        <> v_event_id
      and e.session_id <> ''
  ) into v_is_new_session;

  -- 5) 提取 referrer 域名（去除协议与路径，限制长度）
  v_ref_domain  := lower(regexp_replace(coalesce(p_referrer, ''), '^https?://([^/]+).*$', '\1'));
  v_ref_domain  := case when v_ref_domain = '' then '' else left(v_ref_domain, 128) end;
  v_path_key    := left(p_url_path, 256);
  v_browser_key := left(p_browser, 64);

  -- 6) UPSERT 聚合
  insert into public.page_view_daily_stats (
    profile_id, stat_date, pv, uv, bounce_count, total_ms,
    sources_top, paths_top, devices_top, browsers_top, countries_top
  ) values (
    p_profile_id, v_today,
    1,
    case when v_is_new_uv then 1 else 0 end,
    case when v_is_new_session then 1 else 0 end,
    greatest(p_dwell_ms, 0),
    jsonb_build_object(v_ref_domain, 1),
    jsonb_build_object(v_path_key, 1),
    jsonb_build_object(p_device_type, 1),
    jsonb_build_object(v_browser_key, 1),
    jsonb_build_object(p_country, 1)
  )
  on conflict (profile_id, stat_date) do update set
    pv           = page_view_daily_stats.pv + 1,
    uv           = page_view_daily_stats.uv + case when v_is_new_uv then 1 else 0 end,
    bounce_count = page_view_daily_stats.bounce_count
                   + case when v_is_new_session then 1 else 0 end,
    total_ms     = page_view_daily_stats.total_ms + greatest(p_dwell_ms, 0),
    sources_top  = public._merge_top_n(page_view_daily_stats.sources_top,  v_ref_domain),
    paths_top    = public._merge_top_n(page_view_daily_stats.paths_top,    v_path_key),
    devices_top  = public._merge_top_n(page_view_daily_stats.devices_top,  p_device_type),
    browsers_top = public._merge_top_n(page_view_daily_stats.browsers_top, v_browser_key),
    countries_top= public._merge_top_n(page_view_daily_stats.countries_top, p_country);

  return v_event_id;
end;
$$;

comment on function public.page_view_record(
  uuid, text, text, text, text, text, text, text, text, text, text, integer,
  text, text, text, text, text, text, double precision, double precision,
  text, text, text, text
) is
  'Insert one page view / custom event and update per-day aggregate. SECURITY DEFINER — call only from trusted server-side code.';

-- ---------- 4. PII 清理 ----------
-- 不建议常驻原样保留 IP 与坐标。建议用 pg_cron 每天跑一次，例如：
--   select cron.schedule('prune-visitor-pii', '15 4 * * *',
--                        $$select * from public.prune_visitor_pii(90)$$);
create or replace function public.prune_visitor_pii(p_days integer default 90)
returns table (events_cleared bigint, messages_cleared bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with e as (
    update public.page_view_events
       set ip = null, geo_lat = null, geo_lon = null
     where created_at < now() - make_interval(days => greatest(p_days, 1))
       and (ip is not null or geo_lat is not null or geo_lon is not null)
    returning 1
  ),
  m as (
    update public.chat_visitor_meta
       set ip = null, geo_lat = null, geo_lon = null
     where created_at < now() - make_interval(days => greatest(p_days, 1))
       and (ip is not null or geo_lat is not null or geo_lon is not null)
    returning 1
  )
  select (select count(*) from e)::bigint, (select count(*) from m)::bigint;
end;
$$;

comment on function public.prune_visitor_pii(integer) is
  'Null out raw IP and coordinates older than p_days, keeping ip_hash for de-identified analytics.';
