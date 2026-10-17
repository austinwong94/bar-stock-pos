import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/foodStockHistory.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { localFoodHistory, validCountSummary, countHistoryTotal } = mod.exports;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rows = Array.from({ length: 243 }, (_, n) => ({
  id: uuid(n + 1), ingredient_id: uuid(900), movement_type: 'count',
  quantity_before: 100, quantity_change: n % 3 === 0 ? -0.25 : n % 3 === 1 ? 2 : 0,
  quantity_after: n % 3 === 0 ? 99.75 : n % 3 === 1 ? 102 : 100,
  entered_by: n < 12 ? 'Chloe' : 'Kitchen PIC', reason: 'Weekly Count', notes: n === 0 ? '100%_ checked' : null,
  reference_type: 'stock_count', reference_id: uuid(800), display_unit: 'pack', display_factor: 1,
  created_at: '2026-10-03T16:00:00.000Z', ingredient_items: { name: 'Squid', kitchen_label: 'Sotong', base_unit: 'unit' },
}));
const stockIn = { ...rows[0], id: uuid(300), movement_type: 'stock_in', quantity_change: 1, quantity_after: 101 };
const outside = { ...rows[0], id: uuid(301), created_at: '2026-10-03T15:59:59.999Z' };
const end = { ...rows[0], id: uuid(302), created_at: '2026-10-04T16:00:00.000Z' };
const source = [...rows, stockIn, outside, end];
const args = { p_start: '2026-10-04', p_end: '2026-10-05', p_limit: 50, p_kind: 'count' };
const totals = { total: 243, short: 81, extra: 81, matched: 81 };
assert.equal(validCountSummary(totals), true);
for (const invalid of [null, {}, { ...totals, total: 50 }, { ...totals, extra: -1 }, { ...totals, matched: '81' }]) assert.equal(validCountSummary(invalid), false);
for (const kind of ['count', 'count_short', 'count_extra', 'count_matched']) {
  const ids = []; let cursor = null;
  do {
    const result = localFoodHistory(source, { ...args, p_kind: kind, p_before_created_at: cursor?.created_at, p_before_id: cursor?.id });
    assert.deepEqual(result.count_summary, totals); ids.push(...result.rows.map(r => r.id)); cursor = result.next;
  } while (cursor);
  assert.equal(ids.length, countHistoryTotal(totals, kind)); assert.equal(new Set(ids).size, ids.length);
}
assert.deepEqual(localFoodHistory(source, { ...args, p_search: 'Chloe' }).count_summary, { total: 12, short: 4, extra: 4, matched: 4 });
assert.deepEqual(localFoodHistory(source, { ...args, p_search: 'SOTONG' }).count_summary, totals);
assert.equal(localFoodHistory(source, { ...args, p_kind: 'count_extra', p_search: '%_' }).rows.length, 0);
assert.equal(localFoodHistory(source, { ...args, p_kind: 'in' }).count_summary, null);
console.log('PASS: full-period outcome totals, 243 tied records, pagination, fractional shortages, literal search, kitchen labels, Malaysia boundaries and invalid summaries.');

if (process.env.PGLITE_MODULE) {
  const { PGlite } = await import(process.env.PGLITE_MODULE); const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create function public.has_permission(code text) returns boolean language sql as $$
        select current_setting('test.permission',true)=code $$;
      create table ingredient_items(id uuid primary key,name text,kitchen_label text,category text,base_unit text,active boolean,cost numeric);
      create table ingredient_movements(id uuid primary key,ingredient_id uuid,movement_type text,quantity_change numeric,quantity_before numeric,quantity_after numeric,
        display_unit text,display_factor numeric,entered_by text,reason text,notes text,reference_type text,reference_id uuid,created_at timestamptz,private_cost numeric);
      insert into ingredient_items values('${uuid(900)}','Squid','Sotong','Seafood','unit',false,99),('${uuid(901)}','Gin','Gin','Liquor','ml',true,99);`);
    const liquor = { ...rows[0], id: uuid(303), ingredient_id: uuid(901) };
    for (const row of [...source, liquor]) await db.query('insert into ingredient_movements values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,99)',
      [row.id,row.ingredient_id,row.movement_type,row.quantity_change,row.quantity_before,row.quantity_after,row.display_unit,row.display_factor,row.entered_by,row.reason,row.notes,row.reference_type,row.reference_id,row.created_at]);
    await db.exec(await readFile('supabase/migrations/202610040059_food_count_history_filters.sql', 'utf8'));
    await db.exec("select set_config('test.permission','kitchen.stock.count',false);set role authenticated;");
    const read = async (overrides = {}) => {
      const p = { ...args, p_search: '', p_before_created_at: null, p_before_id: null, ...overrides };
      return (await db.query('select read_food_stock_history($1,$2,$3,$4,$5,$6,$7) result',
        [p.p_start,p.p_end,p.p_search,p.p_kind,p.p_before_created_at,p.p_before_id,p.p_limit])).rows[0].result;
    };
    for (const kind of ['all','in','out','preparation','count','count_short','count_extra','count_matched']) {
      let cursor = null; const ids = [];
      do {
        const p = { p_kind: kind, p_before_created_at: cursor?.created_at ?? null, p_before_id: cursor?.id ?? null };
        const result = await read(p), local = localFoodHistory(source, { ...args, ...p });
        assert.deepEqual(result.count_summary, local.count_summary);
        assert.deepEqual(result.rows.map(r => r.id), local.rows.map(r => r.id));
        assert(result.rows.every(r => !('private_cost' in r) && !('cost' in r.ingredient_items)));
        ids.push(...result.rows.map(r => r.id)); cursor = result.next;
      } while (cursor);
      assert.equal(ids.length, new Set(ids).size);
    }
    for (const query of ['sOtOnG','Chloe','%_','Not Found']) {
      const result = await read({ p_search: query, p_kind: 'count_short' });
      const local = localFoodHistory(source, { ...args, p_search: query, p_kind: 'count_short' });
      assert.deepEqual(result.count_summary, local.count_summary); assert.deepEqual(result.rows.map(r => r.id), local.rows.map(r => r.id));
    }
    const first = await read({ p_kind: 'count_short' });
    const cursor = { p_kind: 'count_short', p_before_created_at: first.next.created_at, p_before_id: first.next.id };
    const older = await read(cursor);
    await db.exec(`reset role;insert into ingredient_movements select '${uuid(999)}',ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,display_unit,display_factor,entered_by,reason,notes,reference_type,reference_id,'2026-10-04T08:00:00Z',99 from ingredient_movements where id='${rows[0].id}';set role authenticated;`);
    const after = await read(cursor);
    assert.deepEqual(after.rows, older.rows); assert.equal(after.count_summary.short, 82);
    for (const invalid of [{ p_kind:'oops' },{ p_start:null },{ p_end:args.p_start },{ p_limit:101 },{ p_before_id:uuid(1) },{ p_search:'x'.repeat(161) }]) await assert.rejects(() => read(invalid));
    for (const permission of ['kitchen.production.manage','purchasing.receive','kitchen.stock.count']) {
      await db.query("select set_config('test.permission',$1,false)",[permission]); assert.equal((await read()).count_summary.total,244);
    }
    await db.exec("select set_config('test.permission','none',false)"); await assert.rejects(() => read(), /Kitchen access required/);
    await db.exec('reset role;set role anon'); await assert.rejects(() => read(), /permission denied/i);
    await db.exec('reset role'); assert.equal((await db.query('select count(*)::integer n from ingredient_movements')).rows[0].n, 248);
    console.log('PASS: SQL/local parity, complete pagination, concurrent insert, privacy, inactive food, restricted roles, invalid arguments and read-only access.');
  } finally { await db.close(); }
}
