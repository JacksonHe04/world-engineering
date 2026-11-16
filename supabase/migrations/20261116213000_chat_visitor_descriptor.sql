-- ============================================================
-- 聊天消息上的访客描述
-- ============================================================
-- 「来自某某地方的访客」这条署名要升级成：
--   名字行：北京海淀的访客
--   描述行：iOS 27.3 · 微信 · WiFi
--
-- 地点复用既有的 location_label（本来就是给这个用途的），这里只补三列。
-- 这三项本身就是要展示给所有人看的，所以可以放在这张匿名可读的表上；
-- 原始 IP 与坐标仍然只在 chat_visitor_meta，不在这里。
-- ============================================================

alter table public.chat_messages
  add column if not exists visitor_os      text not null default '',
  add column if not exists visitor_entry   text not null default '',
  add column if not exists visitor_network text not null default '';

comment on column public.chat_messages.visitor_os is
  'Visitor OS with version, e.g. "iOS 27.3". Empty for messages recorded before 2026-11-16.';
comment on column public.chat_messages.visitor_entry is
  'Entry channel key: wechat / qq / alipay / ... / direct, or an external referrer domain.';
comment on column public.chat_messages.visitor_network is
  'Cellular/wifi hint from the host app UA: 4G / 5G / WIFI.';
