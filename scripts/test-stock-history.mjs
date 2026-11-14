import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function module(path){const b=await build({entryPoints:[path],bundle:true,write:false,format:'cjs',platform:'node'}),m={exports:{}};new Function('module','exports',b.outputFiles[0].text)(m,m.exports);return m.exports;}
const {allocateMoney,allocateSaleItems,reportMoneyCents}=await module('src/lib/moneyAllocation.ts');
const {stockReceivedLabel,attachStockSaleItems}=await module('src/lib/barStockHistory.ts');
const {actualItemSales}=await module('src/lib/reportItems.ts');
assert.deepEqual(allocateMoney(.02,[1,1,1,1]),[.01,.01,0,0],'No negative final line');
assert.deepEqual(allocateMoney(.01,[0,1,1]),[0,.01,0]);
assert.deepEqual(allocateMoney(0,[0,0]),[0,0]);assert.deepEqual(allocateMoney(0,[]),[]);
assert.deepEqual(allocateMoney('9999999999.99',['9999999999.99']),[9999999999.99]);
for(const bad of [null,undefined,true,'',' ','NaN',NaN,Infinity,'1e2',-1,'1.005','10000000000']){assert.throws(()=>reportMoneyCents(bad));assert.throws(()=>allocateMoney(1,[bad]));}
assert.throws(()=>allocateMoney(1,[]));assert.throws(()=>allocateMoney(1,[0,0]));
let cases=0;
for(let count=1;count<=30;count++)for(let total=0;total<200;total++){
 const weights=Array.from({length:count},(_,i)=>((i*37+total*13)%101)/100);if(weights.every(x=>x===0))weights[0]=1;
 const values=allocateMoney(total/100,weights);assert(values.every(x=>Number.isFinite(x)&&x>=0));assert.equal(values.reduce((a,x)=>a+reportMoneyCents(x),0),total);assert.deepEqual(values,allocateMoney(total/100,weights));cases++;
 const gross=weights.reduce((a,x)=>a+reportMoneyCents(x),0),discount=total%(gross+1);const allocated=allocateSaleItems((gross-discount)/100,discount/100,weights);assert.equal(allocated.netLines.reduce((a,x)=>a+reportMoneyCents(x),0),gross-discount);assert.equal(allocated.discounts.reduce((a,x)=>a+reportMoneyCents(x),0),discount);weights.forEach((x,i)=>assert.equal(reportMoneyCents(x),reportMoneyCents(allocated.netLines[i])+reportMoneyCents(allocated.discounts[i])));
}
const en=(a,b)=>a,ms=(a,b)=>b;
const movement={quantity_change:72,unit_input:'carton',input_quantity:null,carton_size_at_time:24};
assert.equal(stockReceivedLabel(movement,en),'3 Cartons');assert.equal(stockReceivedLabel(movement,ms),'3 Karton');
assert.equal(stockReceivedLabel({...movement,carton_size_at_time:null},en),'Carton Count Unavailable');
assert.equal(stockReceivedLabel({...movement,carton_size_at_time:null},ms),'Bilangan Karton Tidak Tersedia');
assert.equal(stockReceivedLabel({...movement,input_quantity:72},en),'Carton Count Unavailable');
assert.equal(stockReceivedLabel({...movement,quantity_change:73},en),'Carton Count Unavailable');
assert.equal(stockReceivedLabel({...movement,unit_input:'can',input_quantity:3},ms),'72 Unit');
assert.throws(()=>stockReceivedLabel({...movement,quantity_change:null},en));
assert.throws(()=>stockReceivedLabel({...movement,quantity_change:-72},en));
const sales=Array.from({length:175},(_,i)=>({id:'sale-'+i,status:'completed',sale_number:'TEST-'+i,total_amount:i===0?.02:1,discount_amount:i===0?3.98:0,payment_method:'cash'}));
const items=sales.flatMap((s,i)=>Array.from({length:i===0?1201:1},(_,j)=>({id:s.id+'-item-'+j,sale_id:s.id,quantity:1,line_total:1,products:{name:j<4?'Stock Test '+j:'Other Test'}})));
const calls=[];const reader=async(ids,from,to)=>{calls.push({ids,from,to});return {data:items.filter(x=>ids.includes(x.sale_id)).slice(from,Math.min(to+1,from+63)),error:null};};
const attached=await attachStockSaleItems(sales,reader);assert.equal(attached[0].sale_items.length,1201);assert(calls.every(c=>c.ids.length<=150));assert(calls.some(c=>c.from>1000));
const rows=actualItemSales([{...attached[0],sale_items:attached[0].sale_items.slice(0,4)}]);assert(rows.every(x=>x.cash>=0&&x.discount>=0));assert.equal(rows.reduce((a,x)=>a+reportMoneyCents(x.cash),0),2);assert.equal(rows.reduce((a,x)=>a+reportMoneyCents(x.discount),0),398);assert.equal(rows.reduce((a,x)=>a+x.quantity,0),4);
assert.deepEqual(actualItemSales([{...attached[0],status:'voided'}]),[]);
assert.throws(()=>actualItemSales([{...sales[0],total_amount:0,sale_items:[]}]));
const small=[.1,.2].map(total=>({...sales[0],total_amount:total,discount_amount:0,sale_items:[{quantity:1,line_total:total,custom_item_name:'Same Item'}]}));const unchanged=JSON.stringify(small);assert.equal(actualItemSales(small)[0].cash,.3);assert.equal(JSON.stringify(small),unchanged);
await assert.rejects(attachStockSaleItems([sales[0]],async()=>({data:null,error:null})));
await assert.rejects(attachStockSaleItems([sales[0]],async()=>({data:[],error:null})));
await assert.rejects(attachStockSaleItems([sales[0]],async()=>({data:null,error:{message:'Offline'}})));
assert.throws(()=>allocateSaleItems(2,0,[1]));
await assert.rejects(attachStockSaleItems([sales[0]],async(ids,from)=>({data:from===0?[items[0],items[0]]:[],error:null})));
await assert.rejects(attachStockSaleItems([sales[0]],async(ids,from)=>({data:from===0?[{...items[0],sale_id:'other'}]:[],error:null})));
console.log('PASS stock history: '+cases+' cent-conserving allocations, nonnegative discounted lines, strict financial inputs, recorded historical carton sizes, EN/MS labels, 1,201 items through short server pages, missing/duplicate/foreign/error reads denied and void exclusion. Read-only.');
