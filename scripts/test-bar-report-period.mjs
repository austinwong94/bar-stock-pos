import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
const bundled=await build({entryPoints:['src/lib/barReportPeriod.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};vm.runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports});
const {barPeriodRange:range,shiftBarPeriod:shift,periodProblemLabel:label}=module.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const original=process.env.TZ;
try{for(const zone of ['Asia/Kuala_Lumpur','UTC','America/New_York','Pacific/Auckland']){
 process.env.TZ=zone;
 assert.deepEqual(plain(range('week','2020-W53').range),{from:'2020-12-28',to:'2021-01-03'});
 assert.deepEqual(plain(range('week','2025-W01').range),{from:'2024-12-30',to:'2025-01-05'});
 assert.equal(range('week','2021-W53').problem,'invalid');
 assert.deepEqual(plain(range('month','2024-02').range),{from:'2024-02-01',to:'2024-02-29'});
 assert.equal(range('day','2023-02-29').problem,'invalid');assert(range('day','2024-02-29').range);
 assert.equal(range('custom','2026-02-02','2026-02-01').problem,'reversed');
 assert(range('custom','2024-01-01','2024-12-31').range);assert.equal(range('custom','2024-01-01','2025-01-01').problem,'too-long');
 assert(range('custom','2026-03-01','2026-11-01').range,'DST does not shorten or lengthen calendar periods');
 assert.equal(shift('day','2024-02-28',1),'2024-02-29');assert.equal(shift('day','2024-02-29',1),'2024-03-01');
 assert.equal(shift('week','2020-W53',1),'2021-W01');assert.equal(shift('week','2021-W01',-1),'2020-W53');
 assert.equal(shift('month','2026-12',1),'2027-01');assert.equal(shift('month','2026-01',-1),'2025-12');
 assert.equal(shift('day','0001-01-01',-1),null);assert.equal(shift('day','9999-12-31',1),null);
 assert.equal(shift('month','0001-01',-1),null);assert.equal(shift('month','9999-12',1),null);
 assert.deepEqual(plain(range('week','0001-W01').range),{from:'0001-01-01',to:'0001-01-07'},'Years below 100 must not become 1901');
 for(const value of ['','nonsense','2026-2-01','2026-13-01','2026-04-31','0000-01-01','10000-01-01','2026-01-01T12:00:00Z'])assert.equal(range('day',value).range,null);
 for(const value of ['','2026-W00','2026-W54','2026-W99','2026-W1','2026-01']){assert.equal(range('week',value).range,null);assert.equal(shift('week',value,1),null);}
 for(const value of ['','2026-00','2026-13','2026-1','0000-01'])assert.equal(range('month',value).range,null);
 assert.equal(range('custom','','2026-01-01').problem,'missing');assert.equal(range('custom','2026-01-01','').problem,'missing');
 for(let year=2000;year<=2040;year++)for(let week=1;week<=53;week++){const value=year+'-W'+String(week).padStart(2,'0'),r=range('week',value);if(!r.range)continue;assert(r.range.from<=r.range.to);assert.equal(shift('week',shift('week',value,1),-1),value);}
 }}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
 assert.equal(label('reversed',(en)=>en),'End date must be on or after start date.');assert.equal(label('missing',(_,ms)=>ms),'Masukkan tarikh laporan.');
 console.log('PASS bar report periods: real calendar/ISO weeks, leap days, year and week boundaries, 366-day complete ranges, missing/reversed/invalid dates, no silent rollover and four browser time zones. Read-only.');
