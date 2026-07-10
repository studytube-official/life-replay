-- ジブンクエスト 自前訪問カウンター用テーブル
-- Supabase (WorkMateと同じプロジェクト zkquchdaizdjrvlsncbs) の
-- SQL Editor にこのファイル全体を貼り付けて Run するだけ。

create table if not exists public.jq_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null,
  lang text,
  ref text,
  meta jsonb
);

alter table public.jq_visits enable row level security;

-- 匿名キーは固定の visit イベントだけ書き込み可。
-- lang/ref/meta は必ず null に制限し、位置データを保存できる余地を作らない。
-- 読み出しポリシーは作らない(生データは外から見えない)。
drop policy if exists "jq_visits_anon_insert" on public.jq_visits;
create policy "jq_visits_anon_insert" on public.jq_visits
  for insert to anon, authenticated
  with check (event = 'visit' and lang is null and ref is null and meta is null);

-- 集計だけを返す関数(?stats 表示用)
create or replace function public.jq_stats()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'total',   (select count(*) from jq_visits where event = 'visit'),
    'last24h', (select count(*) from jq_visits where event = 'visit' and created_at >= now() - interval '24 hours'),
    'last7d',  (select count(*) from jq_visits where event = 'visit' and created_at >= now() - interval '7 days')
  );
$$;

grant execute on function public.jq_stats() to anon, authenticated;
