-- JIBUN QUEST: Google Places候補検索の利用上限
-- Supabase SQL Editorで1回実行する。
-- 座標・検索結果・IPアドレスは保存せず、HMAC化済みclient hashと件数だけを保持する。

create schema if not exists private;
create extension if not exists pg_cron;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.jq_places_usage (
  month_start date primary key,
  calls integer not null default 0 check (calls between 0 and 4500),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists private.jq_places_rate (
  client_hash text not null check (client_hash ~ '^[0-9a-f]{64}$'),
  bucket_kind text not null check (bucket_kind in ('minute', 'day')),
  bucket_start timestamptz not null,
  calls integer not null default 0 check (calls > 0),
  primary key (client_hash, bucket_kind, bucket_start)
);
create index if not exists jq_places_rate_bucket_start_idx
  on private.jq_places_rate (bucket_start);

revoke all on table private.jq_places_usage from public, anon, authenticated;
revoke all on table private.jq_places_rate from public, anon, authenticated;

create or replace function public.jq_reserve_place_lookup(p_client_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_month date;
  v_minute timestamptz;
  v_day timestamptz;
  v_month_calls integer;
  v_minute_calls integer;
  v_day_calls integer;
  v_month_limit constant integer := 4500;
begin
  if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'invalid client hash';
  end if;

  -- Google Maps Platformの月次課金境界に合わせてPacific Timeを使う。
  v_month := date_trunc(
    'month',
    v_now at time zone 'America/Los_Angeles'
  )::date;
  v_minute := date_trunc('minute', v_now);
  v_day := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';

  -- 月間上限とclient rate limitを同じトランザクションで直列化する。
  perform pg_advisory_xact_lock(74261, 4500);

  -- HMAC化済みclient hashも必要期間を越えて保持しない。
  delete from private.jq_places_rate
   where bucket_start < v_now - interval '2 days';

  select calls
    into v_month_calls
    from private.jq_places_usage
   where month_start = v_month;
  v_month_calls := coalesce(v_month_calls, 0);

  if v_month_calls >= v_month_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'monthly',
      'month_used', v_month_calls,
      'month_limit', v_month_limit
    );
  end if;

  select calls
    into v_minute_calls
    from private.jq_places_rate
   where client_hash = p_client_hash
     and bucket_kind = 'minute'
     and bucket_start = v_minute;
  v_minute_calls := coalesce(v_minute_calls, 0);

  if v_minute_calls >= 10 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'minute',
      'month_used', v_month_calls,
      'month_limit', v_month_limit
    );
  end if;

  select calls
    into v_day_calls
    from private.jq_places_rate
   where client_hash = p_client_hash
     and bucket_kind = 'day'
     and bucket_start = v_day;
  v_day_calls := coalesce(v_day_calls, 0);

  if v_day_calls >= 100 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'day',
      'month_used', v_month_calls,
      'month_limit', v_month_limit
    );
  end if;

  insert into private.jq_places_usage as usage (
    month_start,
    calls,
    updated_at
  )
  values (v_month, 1, v_now)
  on conflict (month_start) do update
    set calls = usage.calls + 1,
        updated_at = excluded.updated_at
  returning calls into v_month_calls;

  insert into private.jq_places_rate as rate (
    client_hash,
    bucket_kind,
    bucket_start,
    calls
  )
  values (p_client_hash, 'minute', v_minute, 1)
  on conflict (client_hash, bucket_kind, bucket_start) do update
    set calls = rate.calls + 1;

  insert into private.jq_places_rate as rate (
    client_hash,
    bucket_kind,
    bucket_start,
    calls
  )
  values (p_client_hash, 'day', v_day, 1)
  on conflict (client_hash, bucket_kind, bucket_start) do update
    set calls = rate.calls + 1;

  return jsonb_build_object(
    'allowed', true,
    'reason', null,
    'month_used', v_month_calls,
    'month_limit', v_month_limit
  );
end;
$$;

revoke all on function public.jq_reserve_place_lookup(text)
  from public, anon, authenticated;
grant execute on function public.jq_reserve_place_lookup(text)
  to service_role;

comment on function public.jq_reserve_place_lookup(text) is
  'Atomically reserves one Places lookup: 4500/Pacific billing month, 10/client/minute, 100/client/day.';

-- 検索が行われない期間も、HMAC化済みclient hashを2日超保持しない。
-- 同名ジョブがある場合、cron.scheduleは内容を更新する。
select cron.schedule(
  'jq-places-rate-cleanup',
  '17 4 * * *',
  $$delete from private.jq_places_rate
      where bucket_start < clock_timestamp() - interval '2 days'$$
);
