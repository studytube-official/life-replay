import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sql = await readFile(new URL('../places.sql', import.meta.url), 'utf8')

test('SQLは月4500回のhard capとservice role限定RPCを維持する', () => {
  assert.match(sql, /v_month_limit constant integer := 4500/)
  assert.match(sql, /pg_advisory_xact_lock\(74261, 4500\)/)
  assert.match(sql, /grant execute on function public\.jq_reserve_place_lookup\(text\)\s+to service_role/)
  assert.match(sql, /revoke all on function public\.jq_reserve_place_lookup\(text\)\s+from public, anon, authenticated/)
})

test('HMAC化済みclient hashは2日超を日次削除する', () => {
  assert.match(sql, /create extension if not exists pg_cron/)
  assert.match(sql, /jq-places-rate-cleanup/)
  assert.match(sql, /bucket_start < clock_timestamp\(\) - interval '2 days'/)
})
