import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['src/lib/posDiscount.ts'],bundle:true,write:false,format:'cjs',platform:'node'}),m={exports:{}};new Function('module','exports',b.outputFiles[0].text)(m,m.exports);
const {cartDiscount,posMoneyCents}=m.exports;
for(const [raw,expected] of [['.35',35],[' .5 ',50],['0.01',1],['12.50',1250]])assert.equal(posMoneyCents(raw),expected);
for(const [subtotal,rate,expected] of [[100,.1,10],[200,.1,20],[19.99,.15,3],[.35,.1,.04],[.05,.1,.01],[0,.2,0],[9999999999.99,.2,2000000000]])assert.deepEqual(cartDiscount(subtotal,rate,''),{amount:expected,issue:null});
for(const value of ['1.001','-1','1e2','NaN','Infinity','1,000','1.','100000000'])assert.deepEqual(cartDiscount(100,null,value),{amount:null,issue:'precision'});
assert.deepEqual(cartDiscount(20,null,'50'),{amount:null,issue:'excess'},'No automatic full discount');
for(const value of ['', '0','0.00','  '])assert.deepEqual(cartDiscount(10,null,value),{amount:0,issue:null});
assert.deepEqual(cartDiscount(.87,null,'0.01'),{amount:.01,issue:null});assert.deepEqual(cartDiscount(10,null,'10'),{amount:10,issue:null});
for(const subtotal of [NaN,Infinity,-1,1.001,10000000000])assert.equal(cartDiscount(subtotal,0,'').issue,'subtotal');
for(const rate of [NaN,Infinity,-1,1.1,.155])assert.equal(cartDiscount(100,rate,'').issue,'rate');
for(let cents=0;cents<=10000;cents++)for(const percent of [0,5,10,15,20]){
 const expected=Number((BigInt(cents)*BigInt(percent)+50n)/100n)/100;
 assert.deepEqual(cartDiscount(cents/100,percent/100,''),{amount:expected,issue:null});
}
console.log('PASS POS money: 50,005 cent/percentage cases, half-cent rounding, exact manual amounts, optional blank discount, no negative/non-finite/excess/invalid precision, and numeric storage bounds.');
