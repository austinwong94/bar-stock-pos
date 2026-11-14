import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['src/lib/barSaleAction.ts'],bundle:true,write:false,platform:'node',format:'cjs'}),m={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(m,m.exports);
const {createSaleAction,readSaleAction,writeSaleAction,saleActionConfirmed,saleActionKey}=m.exports;
const actor='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
const sale={id:other,sale_number:'TEST-1',business_date:'2026-11-15',status:'completed',payment_method:'qr',qr_status:'pending',total_amount:24,paid_amount:24,review_version:5};
for(const kind of ['void','verified','mismatch']){
 const operation=createSaleAction(sale,kind,kind==='void'?' Wrong order ':null,actor),raw=JSON.stringify(operation);assert.deepEqual(readSaleAction(raw,actor),operation);assert.equal(operation.args.p_expected_version,5);
 const result={request_id:operation.args.p_request_id,actor_id:actor,action:kind,sale:{...sale,review_version:6,status:kind==='void'?'voided':'completed',qr_status:kind==='void'?'pending':kind,void_reason:kind==='void'?'Wrong order':null,voided_by:kind==='void'?actor:null}};
 assert(saleActionConfirmed(result,operation));
 for(const changed of [{request_id:other},{actor_id:other},{action:'other'},{sale:{...result.sale,id:actor}},{sale:{...result.sale,review_version:5}},{sale:{...result.sale,review_version:7}},{sale:{...result.sale,paid_amount:25}},{sale:{...result.sale,sale_number:'Different'}}])assert(!saleActionConfirmed({...result,...changed},operation));
 assert(!saleActionConfirmed(null,operation));assert.throws(()=>readSaleAction(raw,other));
 const values=new Map(),store={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const retained=writeSaleAction(store,'key',operation,null);assert.equal(retained,raw);assert.throws(()=>writeSaleAction(store,'key',null,null));assert.equal(values.get('key'),raw);writeSaleAction(store,'key',null,raw);assert.equal(values.size,0);
 assert.throws(()=>writeSaleAction({...store,setItem(){throw Error('Quota')}},'key',operation,null));
}
for(const review_version of [undefined,null,-1,1.5,NaN,Infinity,'5',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>createSaleAction({...sale,review_version},'void','Reason',actor));
for(const changed of [{status:'voided'},{id:'bad'},{business_date:'2026-02-30'},{paid_amount:24.001}])assert.throws(()=>createSaleAction({...sale,...changed},'void','Reason',actor));
assert.throws(()=>createSaleAction(sale,'void',' ',actor));assert.throws(()=>createSaleAction({...sale,qr_status:'verified'},'verified',null,actor));assert.throws(()=>createSaleAction({...sale,payment_method:'cash'},'mismatch',null,actor));
const foc=createSaleAction({...sale,payment_method:'complimentary',paid_amount:0},'void','FOC correction',actor);assert.equal(foc.summary.amount,24);assert.equal(foc.summary.paidAmount,0);
for(const raw of ['{broken','{}','null',''])assert.throws(()=>readSaleAction(raw,actor));assert.equal(readSaleAction(null),null);assert.notEqual(saleActionKey('one',actor),saleActionKey('two',actor));assert.notEqual(saleActionKey('one',actor),saleActionKey('one',other));
console.log('PASS sale-action protocol: exact retained actor/request/version, strict action/date/money, no missing-version defaults, reply identity/state checks, corrupt/foreign data retention, quota and cross-tab CAS guards.');
