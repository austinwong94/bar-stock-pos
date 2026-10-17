import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {admission,sourceFingerprint} from './release/admission.mjs';
import {root, migrationFingerprint} from './release/database.mjs';
import {runActivePlatformTests} from '../supabase/tests/active-platform.mjs';
import {runStaffWorkTests} from '../supabase/tests/staff-work.mjs';
import {runKitchenMeasureTests} from '../supabase/tests/kitchen-measure.mjs';
import {runKitchenUnitBatchTests} from '../supabase/tests/kitchen-unit-batch.mjs';
import {runStaffAccountTests} from '../supabase/tests/staff-accounts.mjs';
import {walk} from './release/admission.mjs';
import {createServer} from 'node:http';
import path from 'node:path';
const startedAt=new Date().toISOString(),receipt={startedAt,level:'local',status:'RUNNING',stages:[],hostedProviderAcceptance:'NOT RUN',production:'NOT QUALIFIED'};
await mkdir(root+'/.qa/release',{recursive:true});
async function stage(name,level,operation){const start=Date.now();try{const evidence=await operation();receipt.stages.push({name,level,status:'PASS',elapsedMs:Date.now()-start,evidence});}catch(error){receipt.stages.push({name,level,status:'FAIL',elapsedMs:Date.now()-start,error:{code:error.code??null,message:error.message}});throw error;}}
const command=(args,env={})=>new Promise((resolve,reject)=>{const childEnv={...process.env,...env};for(const key of Object.keys(childEnv))if(childEnv[key]===undefined)delete childEnv[key];const child=spawn(process.execPath,args,{cwd:root,env:childEnv,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(args[0]+' exited '+code)));});
const sampleCommand=args=>command(args,{VITE_SUPABASE_URL:undefined,VITE_SUPABASE_ANON_KEY:undefined,GITHUB_PAGES:'false'});
async function sampleLayouts(){
 const directory=path.join(root,'dist');
 const server=createServer(async(req,res)=>{try{
   const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const file=path.resolve(directory,'.'+(relative==='/'?'/index.html':relative));
   if(!file.startsWith(directory+path.sep))throw Error('Invalid path');
   res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'text/html');
   res.end(await readFile(file));
 }catch{res.statusCode=404;res.end('Not found');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await command(['scripts/test-launch-smoke-ui.mjs'],{TEST_URL:'http://127.0.0.1:'+server.address().port});}
 finally{await new Promise(resolve=>server.close(resolve));}
}
try{
 const initial=await admission();receipt.source=initial.source;receipt.dependencyLock=initial.lock;receipt.schema=await migrationFingerprint();receipt.inventory=initial.inventory;
 const pkg=JSON.parse(await readFile(root+'/package.json','utf8'));
 const mode=pkg.name==='lovely-paradise-review'?'sample':'cloud';receipt.buildMode=mode;
 await stage('Types','static',()=>command(['node_modules/typescript/bin/tsc','-b']));
 await stage('Recovery and totals','unit',()=>command(['scripts/test-platform-reliability.mjs']));
 await stage('Stock-out recovery','unit',()=>command(['scripts/test-stock-out.mjs']));
 await stage('Receiving units and measured pieces','unit',()=>command(['scripts/test-delivery-entry.mjs']));
 await stage('Durable delivery identity and recovery','unit',()=>command(['scripts/test-delivery-recovery.mjs']));
 await stage('Supplier-payment identity and recovery','unit',()=>command(['scripts/test-purchase-payment-recovery.mjs']));
 await stage('Staff dates, privacy and recovery','unit',()=>command(['scripts/test-staff-work.mjs']));
 await stage('Staff account provisioning protocol','unit',()=>command(['scripts/test-staff-accounts.mjs']));
 await stage('Metric recording quantities','unit',()=>command(['scripts/test-kitchen-measure.mjs']));
 await stage('Daily usage draft recovery','unit',()=>command(['scripts/test-usage-draft.mjs']));
 await stage('Kitchen quick-entry safeguards','unit',()=>command(['scripts/test-kitchen-quick-entry.mjs']));
 await stage('Kitchen request draft authority','unit',()=>command(['scripts/test-kitchen-request-draft.mjs']));
 await stage('Exact request receipt matching','unit',()=>command(['scripts/test-request-receipt.mjs']));
 await stage('Bulk kitchen units and recovery','unit',()=>command(['scripts/test-kitchen-unit-batch.mjs']));
 await stage('Receipt scanner protocol','unit',()=>command(['scripts/test-receipt-review.mjs']));
 await stage('Finance export calculations and scope','unit',()=>command(['scripts/test-finance-export.mjs']));
 await stage('Finance source drill-through','unit',()=>command(['scripts/test-finance-inspection.mjs']));
 await stage('Pending-work identity and paging','unit',()=>command(['scripts/test-kitchen-work-queue.mjs']));
 await stage('Connected active database journeys','native-postgres',()=>runActivePlatformTests());
 await stage('Named staff attendance and leave','native-postgres',()=>runStaffWorkTests());
 await stage('Audited staff accounts and last-owner protection','native-postgres',()=>runStaffAccountTests());
 await stage('Metric kitchen ledger journey','native-postgres',()=>runKitchenMeasureTests());
 await stage('Atomic bulk kitchen unit settings','native-postgres',()=>runKitchenUnitBatchTests());
 await stage('Build','static',()=>command(['node_modules/vite/bin/vite.js','build'],{VITE_DEMO_MODE:mode==='sample'?'true':'false'}));
 await stage('Page delivery and load budgets','built-browser-and-static',()=>command(['scripts/test-build-delivery.mjs',mode]));
 await stage('Account identity changes','local-browser-contract',()=>command(['scripts/test-access-session-ui.mjs']));
 await stage('Admin staff accounts and username login','local-browser-contract',()=>command(['scripts/test-staff-accounts-ui.mjs']));
 await stage('Financial failure and recovery screens','local-browser-contract',()=>command(['scripts/test-bar-financial-ui.mjs']));
 await stage('Fresh manual bar and water entries','sample-browser',()=>sampleCommand(['scripts/test-manual-entry-ui.mjs']));
 await stage('Measured receiving review and recovery','sample-browser',()=>sampleCommand(['scripts/test-measured-receiving-ui.mjs']));
 await stage('Finance exports and report scope','sample-browser-and-read-fixture',()=>sampleCommand(['scripts/test-finance-export-ui.mjs']));
 await stage('Supplier payments and Finance follow-up','sample-browser',()=>sampleCommand(['scripts/test-purchase-payment-ui.mjs']));
 await stage('Staff attendance and leave workflow','sample-browser',()=>sampleCommand(['scripts/test-staff-work-ui.mjs']));
 await stage('Metric arrivals, usage and stock checks','sample-browser',()=>sampleCommand(['scripts/test-kitchen-measure-ui.mjs']));
 await stage('Mobile kitchen quick-entry and recovery','sample-browser',()=>sampleCommand(['scripts/test-kitchen-quick-entry-ui.mjs']));
 await stage('Mobile request lists and reviewed submission','sample-browser',()=>sampleCommand(['scripts/test-kitchen-request-ui.mjs']));
 await stage('Purchaser receipt entry and partial purchase','sample-browser',()=>sampleCommand(['scripts/test-request-receipt-ui.mjs']));
 await stage('Waste typing drafts and mobile recovery','sample-browser',()=>sampleCommand(['scripts/test-waste-draft-ui.mjs']));
 await stage('Bulk kitchen unit setup workflow','sample-browser',()=>sampleCommand(['scripts/test-kitchen-unit-batch-ui.mjs']));
 await stage('One-click pending-work recovery','sample-browser',()=>sampleCommand(['scripts/test-kitchen-work-queue-ui.mjs']));
 await stage('Compact kitchen navigation and accessibility','sample-browser',()=>sampleCommand(['scripts/test-kitchen-header-ui.mjs']));
 if(mode==='sample')await stage('Unlocked active route layouts','sample-browser',sampleLayouts);
 else receipt.stages.push({name:'Unlocked active route layouts',level:'sample-browser',status:'NOT RUN',reason:'Cloud artifact requires real hosted Auth; financial/account-switch UI contracts ran with controlled fixtures.'});
 if(await sourceFingerprint()!==initial.source)throw new Error('Candidate changed during verification. Preserve evidence and validate the changed inputs.');
 receipt.artifactIndex=createHash('sha256').update(await readFile(root+'/dist/index.html')).digest('hex');
 const artifact=createHash('sha256');for(const file of await walk(root+'/dist'))artifact.update(path.relative(root+'/dist',file)+'\0').update(await readFile(file));receipt.artifact=artifact.digest('hex');
 receipt.status='LOCALLY QUALIFIED';receipt.finishedAt=new Date().toISOString();
 console.log('Local release checks passed. Hosted Auth, physical Storage, provider billing, backups and pilot acceptance remain separate gates.');
}catch(error){receipt.status='FAILED';receipt.finishedAt=new Date().toISOString();console.error(error.message);process.exitCode=1;}
finally{await writeFile(root+'/.qa/release/receipt.json',JSON.stringify(receipt,null,2));}
