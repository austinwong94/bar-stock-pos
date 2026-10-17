import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require=createRequire(import.meta.url);
async function moduleAt(file) {
  const result=await build({entryPoints:[new URL('../src/lib/'+file,import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs'});
  const module={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
  return module.exports;
}
const {barStockEntryIssue,barStockQuantity,changeBarStockUnit}=await moduleAt('barStockEntry.ts');
const blankStock={quantity:'',unit:'can',cost:''};
for(const quantity of ['-2','1.5','1e2','1,000','abc','0','9007199254740992'])assert.equal(barStockEntryIssue({...blankStock,quantity},24),'quantity',quantity+' must never be silently rewritten or omitted');
assert.equal(barStockQuantity('0003'),3);assert.equal(barStockEntryIssue({...blankStock,quantity:'3'},24),null);
for(const cost of ['-2','12.345','1.2.3','1e2','Infinity'])assert.equal(barStockEntryIssue({...blankStock,quantity:'3',cost},24),'cost');
assert.equal(barStockEntryIssue({...blankStock,cost:'12'},24),'quantity','A cost without a received quantity cannot be silently skipped');
const carton={quantity:'2',unit:'carton',cartonSize:24,cost:'12.30'};
assert.equal(barStockEntryIssue(carton,24),null);assert.equal(barStockEntryIssue(carton,12),'carton','Changed pack size needs manual quantity re-entry');
assert.equal(barStockEntryIssue({...carton,quantity:'2147483647'},24),'quantity');
assert.deepEqual(changeBarStockUnit(carton,'can'),{...carton,unit:'can',quantity:'',cartonSize:undefined});
assert.equal(changeBarStockUnit(carton,'carton'),carton,'Tapping the current unit preserves the current manually typed draft');
assert.equal(barStockEntryIssue(blankStock,24),null);
console.log('PASS: manual bar quantities, invalid raw input rejection, no silent cost rounding, whole-unit limits, changed carton setup and unit-switch re-entry.');

const {readAllRows}=await moduleAt('readAllRows.ts');
const source=Array.from({length:1205},(_,id)=>({id}));
const loaded=await readAllRows(async from=>({data:source.slice(from,from+37),error:null}));
assert.deepEqual(loaded,source,'Project caps smaller than the requested page cannot truncate results');
await assert.rejects(()=>readAllRows(async()=>({data:null,error:new Error('offline')})),/offline/);
console.log('PASS: >1,000 records, small server caps, empty results and failed loads.');

const {persistPendingSale,readPendingSale,clearPendingSale,submitPendingSale}=await moduleAt('pendingSale.ts');
const values=new Map();
const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size;}};
const pending={version:1,createdAt:'2026-09-22T00:00:00Z',payload:{p_idempotency_key:'stable-sale',p_items:[{product_id:'lager',quantity:2}],p_payment_method:'cash'},summary:{items:['Lager x 2'],total:24,staff:'Staff',method:'cash',table:'3'}};
persistPendingSale(storage,'cashier',pending);
assert.deepEqual(readPendingSale(storage,'cashier'),pending,'Reload retains the exact request');
assert.equal(readPendingSale(storage,'another-cashier'),null,'Pending requests are scoped to their account');
let calls=0,commits=0;const saved=new Map();
const client={async rpc(name,payload){assert.equal(name,'complete_sale_with_qr_type');assert.deepEqual(payload,pending.payload);calls++;if(!saved.has(payload.p_idempotency_key)){saved.set(payload.p_idempotency_key,{sale_number:'S-1',total_amount:24});commits++;}if(calls===1)throw new Error('Lost response after commit');return {data:saved.get(payload.p_idempotency_key),error:null};}};
await assert.rejects(()=>submitPendingSale(client,pending),/Lost response/);
assert.equal((await submitPendingSale(client,readPendingSale(storage,'cashier'))).sale_number,'S-1');
assert.equal(commits,1,'Uncertain retries cannot create a second sale');
const recoveryClient=(data,error=null)=>({
  from(){throw new Error('Recovery must not bypass the server request validation');},
  async rpc(name,args){assert.equal(name,'complete_sale_with_qr_type');assert.deepEqual(args,pending.payload);return {data,error};},
});
assert.equal((await submitPendingSale(recoveryClient({sale_number:'S-1',status:'voided'}),pending)).status,'voided');
await assert.rejects(()=>submitPendingSale(recoveryClient(null,{code:'42501',message:'Permission changed'}),pending),error=>error instanceof Error && !error.code,'Permission changes cannot discard an unresolved payment');
await assert.rejects(()=>submitPendingSale(recoveryClient(null,{code:'LP001',message:'Different payment details'}),pending),error=>error.code==='LP001');
await assert.rejects(()=>submitPendingSale(recoveryClient(null),pending),/confirmation has not arrived/);
persistPendingSale(storage,'cashier',{...pending,createdAt:'2026-09-22T01:00:00Z',payload:{...pending.payload,p_idempotency_key:'other-tab'}});
clearPendingSale(storage,'cashier',pending);
assert.equal(readPendingSale(storage,'cashier').payload.p_idempotency_key,'other-tab','One tab cannot erase another pending payment');
assert.throws(()=>persistPendingSale(storage,'cashier',{...pending,payload:{...pending.payload,p_idempotency_key:'other-tab'},summary:{...pending.summary,total:30}}),/different saved details/);
assert.throws(()=>persistPendingSale({...storage,setItem(){throw new Error('Storage blocked');}},'cashier',pending),/Storage blocked/);
console.log('PASS: refresh recovery, lost responses, account isolation, two tabs and storage failures.');

const {readClosingAttempt,storeClosingAttempt,submitClosing,readClosingSnapshot}=await moduleAt('barClosing.ts');
const closing={version:1,attempted:false,createdAt:'2026-10-14T00:00:00Z',payload:{p_business_date:'2026-10-14',p_actual_cash_counted:124,p_notes:null,p_expected_version:'reviewed',p_request_id:'closing-one'}};
storeClosingAttempt(storage,'closing/owner',closing);assert.deepEqual(readClosingAttempt(storage,'closing/owner'),closing);
assert.equal(readClosingAttempt(storage,'closing/cook'),null);
assert.throws(()=>storeClosingAttempt(storage,'closing/owner',{...closing,payload:{...closing.payload,p_actual_cash_counted:125}}),/original pending/);
await assert.rejects(()=>readClosingSnapshot({rpc:async()=>({data:null,error:{message:'Read failed'}})},'2026-10-14'),e=>e.message==='Read failed');
await assert.rejects(()=>readClosingSnapshot({rpc:async()=>({data:{business_date:'2026-10-14'},error:null})},'2026-10-14'),/incomplete/);
await assert.rejects(()=>submitClosing({rpc:async()=>({data:null,error:null})},closing),/incomplete/);
const original={id:'report-one',business_date:'2026-10-14',status:'closed'};
const closeClient={rpc:async(name,args)=>{assert.equal(name,'close_daily_report_checked');assert.deepEqual(args,closing.payload);return {data:original,error:null};}};
assert.equal((await submitClosing(closeClient,readClosingAttempt(storage,'closing/owner'))).id,original.id);
console.log('PASS: closing account isolation, immutable retry, failed/incomplete reads and authoritative confirmation.');

const {passengerLabel}=await moduleAt('passengerLabel.ts');
assert.equal(passengerLabel('elderly',en=>en),'Adult');
assert.equal(passengerLabel('infant',(_en,ms)=>ms),'Bayi');
const {gridRows}=await moduleAt('bookingGrid.ts');
const booking={id:'b',lead_name:'Group',pax_adults:2,pax_children:0,pickup_required:false};
const sheet={bookings:[booking],boats:[],employees:[],runs:[],vehicles:[],agencies:[]};
const payments=[100,150,200].map((amount,i)=>({id:String(i),booking_id:'b',amount,kind:'receipt',payment_date:'2026-09-22',created_at:String(i),voided_at:null}));
payments.push({...payments[0],id:'refund',kind:'refund',amount:50});
payments.push({...payments[0],id:'voided',amount:999,voided_at:'2026-09-22'});
const row=gridRows(sheet,{accounts:[{booking_id:'b',amount_due:600}],payments,referrers:[]})[0];
assert.equal(row.values.net_paid,'400.00');assert.equal(row.values.balance,'200.00');assert.equal(row.values.payment_count,'4');
console.log('PASS: legacy adults, Malay labels, extra receipts, refunds and voided payments.');

if (process.env.PGLITE_MODULE) {
  const {PGlite}=await import(process.env.PGLITE_MODULE);
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create function public.has_permission(text) returns boolean language sql stable as $$ select current_setting('test.allowed',true)='yes' $$;
      create table sales(id int primary key,status text,business_date date,payment_method text,paid_amount numeric,total_amount numeric);
      create table sale_items(sale_id int,product_id text,quantity int);
      grant select on sales,sale_items to authenticated;
      insert into sales select id,'completed','2026-09-22','cash',12,12 from generate_series(1,1205) id;
      insert into sale_items select id,'lager',2 from generate_series(1,1205) id;
      insert into sales values(1206,'completed','2026-09-22','qr',28,28),(1207,'completed','2026-09-22','complimentary',0,16),(1208,'voided','2026-09-22','cash',99,99),(1209,'completed','2026-09-21','cash',5,5);
      select set_config('test.allowed','yes',false);`);
    await db.exec(await readFile(new URL('../supabase/migrations/202609220047_bar_overview.sql',import.meta.url),'utf8'));
    await db.exec('set role authenticated');
    const overview=(await db.query("select public.read_bar_overview('2026-09-22','2026-09-22','2026-09-22') as result")).rows[0].result;
    assert.deepEqual(overview,{totals:{cash:14460,qr:28,focCost:16,paidRevenue:14488,tx:1207},soldToday:{lager:2410}});
    await db.exec("select set_config('test.allowed','no',false)");
    await assert.rejects(()=>db.query("select public.read_bar_overview('2026-09-22','2026-09-22','2026-09-22')"),/Bar access/);
    await db.exec("select set_config('test.allowed','yes',false)");
    await assert.rejects(()=>db.query("select public.read_bar_overview('2026-09-22','2026-09-21','2026-09-22')"),/valid reporting period/);
    console.log('PASS: PostgreSQL aggregate includes 1,205 cash sales, QR, FOC and stock units; excludes voids/other dates; access and date guards.');
  } finally {await db.close();}
}
