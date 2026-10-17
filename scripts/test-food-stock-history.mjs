import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/lib/foodStockHistory.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
const module = { exports: {} }; new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { historyRange, historyPeriodStart, historyPeriodValue, localFoodHistory } = module.exports;
assert.deepEqual(historyRange('2026-09-22', 'day'), { start: '2026-09-22', end: '2026-09-23' });
assert.deepEqual(historyRange('2026-09-22', 'week'), { start: '2026-09-21', end: '2026-09-28' });
assert.deepEqual(historyRange('2026-03-31', 'month', -1), { start: '2026-02-01', end: '2026-03-01' });
assert.deepEqual(historyRange('2024-02-29', 'month'), { start: '2024-02-01', end: '2024-03-01' });
assert.deepEqual(historyRange('2026-12-31', 'day', 1), { start: '2027-01-01', end: '2027-01-02' });
assert.equal(historyPeriodValue('2027-01-01', 'week'), '2026-W53');
assert.equal(historyPeriodStart('2026-W53', 'week'), '2026-12-28');
assert.equal(historyPeriodStart('2026-02-30', 'day'), null);
assert.equal(historyPeriodStart('2026-W54', 'week'), null);
assert.equal(historyPeriodStart('2026-13', 'month'), null);
assert.equal(historyPeriodStart('2025-W53', 'week'), null);

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rows = Array.from({ length: 235 }, (_, n) => ({
  id: uuid(n + 1), ingredient_id: uuid(900), movement_type: n % 2 ? 'waste' : 'stock_in',
  quantity_change: n % 2 ? -100 : 1000, quantity_before: 5000, quantity_after: n % 2 ? 4900 : 6000,
  entered_by: n % 2 ? 'Chloe' : 'Happy', reason: n % 2 ? 'Spoilage' : null,
  notes: n === 0 ? '100%_ inspected' : null, reference_id: uuid(800),
  created_at: '2026-09-21T16:00:00.000Z', ingredient_items: { name: 'Squid', base_unit: 'g' },
}));
const args = { p_start: '2026-09-22', p_end: '2026-09-23', p_limit: 50 };
const ids = []; let cursor = null;
do {
  const page = localFoodHistory(rows, { ...args, p_before_created_at: cursor?.created_at, p_before_id: cursor?.id });
  ids.push(...page.rows.map(row => row.id)); cursor = page.next;
} while (cursor);
assert.equal(ids.length, 235); assert.equal(new Set(ids).size, 235);
assert.equal(localFoodHistory(rows, { ...args, p_search: '%_' }).rows.length, 1);
assert.equal(localFoodHistory(rows, { ...args, p_search: 'chloe', p_kind: 'in' }).rows.length, 0);
assert.equal(localFoodHistory(rows, { ...args, p_search: 'spoilage', p_kind: 'out' }).rows.length, 50);
assert.equal(localFoodHistory(rows, { ...args, p_search: uuid(800) }).rows.length, 50);
const boundaryRows = [
  { ...rows[0], id: uuid(701), created_at: '2026-09-21T15:59:59.999Z' },
  { ...rows[0], id: uuid(702), created_at: '2026-09-21T16:00:00.000Z' },
  { ...rows[0], id: uuid(703), created_at: '2026-09-22T15:59:59.999Z' },
  { ...rows[0], id: uuid(704), created_at: '2026-09-22T16:00:00.000Z' },
];
assert.deepEqual(localFoodHistory(boundaryRows, args).rows.map(r => r.id), [uuid(703), uuid(702)]);
console.log('PASS: Malaysia midnight, ISO weeks/year, leap months, date arrows, literal search, filters and 235-row tied cursor traversal.');

if (process.env.PGLITE_MODULE) {
  const { PGlite } = await import(process.env.PGLITE_MODULE); const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create function public.require_permission(code text) returns void language plpgsql as $$begin
        if code<>'kitchen.production.manage' or current_setting('test.allow',true)='none' then raise exception 'Permission denied' using errcode='42501';end if;
      end$$;
      create table ingredient_items(id uuid primary key,name text,category text,base_unit text,active boolean,cost_per_base_unit numeric);
      create table ingredient_movements(id uuid primary key,ingredient_id uuid,movement_type text,quantity_change numeric,quantity_before numeric,quantity_after numeric,entered_by text,reason text,notes text,reference_id uuid,created_at timestamptz);
      insert into ingredient_items values('${uuid(900)}','Squid','Seafood','g',false,42),('${uuid(901)}','Gin','Liquor','ml',true,99);
      select set_config('test.allow','all',false);`);
    for (const row of [...rows, ...boundaryRows]) await db.query(
      'insert into ingredient_movements values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [row.id,row.ingredient_id,row.movement_type,row.quantity_change,row.quantity_before,row.quantity_after,row.entered_by,row.reason,row.notes,row.reference_id,row.created_at]);
    await db.exec(`insert into ingredient_movements select '${uuid(999)}','${uuid(901)}',movement_type,quantity_change,quantity_before,quantity_after,entered_by,reason,notes,reference_id,created_at from ingredient_movements limit 1;`);
    await db.exec(await readFile('supabase/migrations/202609220050_food_stock_history.sql', 'utf8'));
    await db.exec('set role authenticated');
    const read = async (overrides = {}) => {
      const p = { ...args, p_kind:'all', p_search:'', p_before_created_at:null, p_before_id:null, ...overrides };
      return (await db.query('select read_food_stock_history($1,$2,$3,$4,$5,$6,$7) result',
        [p.p_start,p.p_end,p.p_search,p.p_kind,p.p_before_created_at,p.p_before_id,p.p_limit])).rows[0].result;
    };
    let next = null; const all = [];
    do {
      const page = await read({ p_before_created_at:next?.created_at??null, p_before_id:next?.id??null });
      all.push(...page.rows); next=page.next;
      if (all.length > 1000) throw new Error('Cursor did not advance');
    } while(next);
    const expected = [...rows,...boundaryRows].filter(r=>r.id!==uuid(701)&&r.id!==uuid(704));
    assert.equal(all.length, 237); assert.equal(new Set(all.map(r=>r.id)).size,237);
    assert.deepEqual(new Set(all.map(r=>r.id)),new Set(expected.map(r=>r.id)));
    assert(all.every(r=>r.ingredient_items.name==='Squid'&&!('cost_per_base_unit' in r.ingredient_items)));
    assert.equal((await read({p_search:'%_'})).rows.length,3,'Wildcards are literal, not broad searches');
    assert.equal((await read({p_kind:'out',p_search:'hApPy'})).rows.length,0);
    assert.equal((await read({p_kind:'out',p_search:'CHLOE'})).rows.length,50);
    assert.equal((await read({p_kind:'count'})).rows.length,0);
    assert.equal((await read({p_search:uuid(800)})).rows.length,50);
    const first = await read();
    const olderArgs = {p_before_created_at:first.next.created_at,p_before_id:first.next.id};
    const olderBefore = await read(olderArgs);
    await db.exec(`reset role; insert into ingredient_movements select '${uuid(998)}',ingredient_id,'count',0,quantity_before,quantity_before,entered_by,reason,notes,reference_id,'2026-09-22T12:00:00Z' from ingredient_movements where ingredient_id='${uuid(900)}' limit 1; set role authenticated;`);
    assert.deepEqual((await read(olderArgs)).rows,olderBefore.rows,'New records cannot shift the next page');
    assert((await read()).rows.some(row=>row.id===uuid(998)),'Refresh can retrieve the newly recorded movement');
    assert.equal((await read({p_kind:'count'})).rows.length,1);
    for (const invalid of [{p_end:args.p_start},{p_start:null},{p_end:'2028-01-01'},{p_kind:'unknown'},{p_limit:500},{p_search:'x'.repeat(161)},{p_before_id:uuid(1)}]) await assert.rejects(()=>read(invalid));
    await db.exec("select set_config('test.allow','none',false)"); await assert.rejects(()=>read(),/Permission denied/);
    await db.exec('reset role; set role anon'); await assert.rejects(()=>read(),/permission denied/i);
    console.log('PASS: SQL >200 rows, tied cursors, concurrent insert, Malaysia dates, inactive food, liquor/cost exclusion, literal filters, validation and permissions.');
  } finally { await db.close(); }
}
