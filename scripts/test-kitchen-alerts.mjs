import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['supabase/functions/send-kitchen-alerts/sender.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
const mod={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(mod,mod.exports);
const {sendTelegram}=mod.exports,alert={id:'1',claim_id:'1',title:'Request',body:'<untrusted>\nRice 5 pack',rule_code:'kitchen.request_submitted'};
let payload;
const sent=await sendTelegram(alert,'test-token','-100123','https://example.test',async(url,options)=>{assert.equal(url,'https://api.telegram.org/bottest-token/sendMessage');payload=JSON.parse(options.body);return Response.json({ok:true,result:{message_id:42}});});
assert.deepEqual(sent,{status:'sent',providerId:'42'});assert.equal(payload.chat_id,'-100123');assert(!payload.parse_mode);assert(payload.text.includes('/#/kitchen/purchases'));
assert.equal((await sendTelegram(alert,'secret','group','https://example.test',async()=>Response.json({ok:false,error_code:429,description:'secret'},{status:429}))).status,'failed');
for(const response of [async()=>new Response('gateway error',{status:502}),async()=>{throw new Error('secret');},async()=>Response.json({ok:true,result:{}})]){
  const result=await sendTelegram(alert,'secret','group','https://example.test',response);assert.equal(result.status,'uncertain');assert(!result.error.includes('secret'));
}
await sendTelegram({...alert,body:'x'.repeat(9000),rule_code:'kitchen.count_confirmed'},'token','group','https://example.test',async(_,options)=>{const text=JSON.parse(options.body).text;assert(text.length<4096);assert(text.endsWith('type=count'));return Response.json({ok:true,result:{message_id:1}});});
console.log('PASS: verified Telegram response, safe text, group destination, correct links, long-message limit, explicit rejection vs ambiguous delivery, secrets absent from errors.');

if(process.env.PGLITE_MODULE){
  const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table profiles(id uuid primary key,full_name text);
      create table notification_rules(code text primary key,name text,department_code text,enabled boolean,sort_order int);
      create table outbound_messages(id uuid primary key default gen_random_uuid(),rule_code text,title text,body text,service_date date,reference_type text,reference_id uuid,created_at timestamptz default now(),status text default 'queued',channel text default 'whatsapp',sent_at timestamptz,send_note text);
      create table audit_logs(id uuid primary key default gen_random_uuid(),actor_id uuid,action text,entity_type text,entity_id uuid,after_json jsonb,created_at timestamptz default now());
      create function require_permission(code text) returns void language plpgsql as $$begin if current_setting('test.permission',true) is distinct from code then raise exception 'Permission denied';end if;end$$;
      create function queue_outbound_message(code text,title text,body text,d date,kind text,id uuid) returns uuid language plpgsql as $$declare result uuid;begin
        if not exists(select 1 from notification_rules r where r.code=$1 and enabled) then return null;end if;
        insert into outbound_messages(rule_code,title,body,service_date,reference_type,reference_id) values(code,title,body,d,kind,id) returning outbound_messages.id into result;return result;end$$;
      insert into notification_rules values('kitchen.request_submitted','Request','kitchen',true,1),('fleet.assignment_completed','Boat','fleet',true,2);`);
    await db.exec(await readFile('supabase/migrations/202610040060_kitchen_group_alerts.sql','utf8'));
    const actor=crypto.randomUUID();await db.query('insert into profiles values($1,$2)',[actor,'Kitchen PIC']);
    for(const [action,after] of [['kitchen_stock_count',{items:[{quantity:10}]}],['kitchen_arrival',{lines:[{},{}]}],['receive_purchase_batch',{receipts:[{}]}],['save_delivery_draft',{items:[{}]}]])await db.query('insert into audit_logs(actor_id,action,entity_type,entity_id,after_json) values($1,$2,$3,$4,$5)',[actor,action,'kitchen',crypto.randomUUID(),JSON.stringify(after)]);
    assert.equal((await db.query('select count(*)::int n from outbound_messages')).rows[0].n,3,'Draft produces no alert');
    const countBody=(await db.query("select body from outbound_messages where rule_code='kitchen.count_confirmed'")).rows[0].body;assert(countBody.includes('Kitchen PIC'));assert(countBody.includes('1 items'));assert(countBody.includes('MYT'));
    await db.exec("insert into outbound_messages(rule_code,title,body) values('kitchen.request_submitted','Request','Rice 5 pack'),('fleet.assignment_completed','Boat','Private guests');");
    assert.equal((await db.query('select count(*)::int n from kitchen_alert_deliveries')).rows[0].n,4,'Only kitchen notifications');
    await db.exec('set role anon');await assert.rejects(()=>db.query('select claim_kitchen_alerts()'),/permission denied/);
    await db.exec('reset role;set role authenticated');await assert.rejects(()=>db.query('select claim_kitchen_alerts()'),/permission denied/);await assert.rejects(()=>db.query('select read_kitchen_alerts()'),/Permission denied/);await assert.rejects(()=>db.query('select * from kitchen_alert_deliveries'),/permission denied/);
    await db.exec("select set_config('test.permission','platform.settings.manage',false)");assert.equal((await db.query('select read_kitchen_alerts() r')).rows[0].r.messages.length,4);
    await db.exec('reset role;set role service_role');const claim=async n=>(await db.query('select claim_kitchen_alerts($1) r',[n])).rows[0].r;
    const first=await claim(2),second=await claim(2);assert.equal(first.length,2);assert.equal(second.length,2);assert.equal((await claim(2)).length,0);assert.equal(new Set([...first,...second].map(x=>x.id)).size,4);
    const finish=async(row,status,id=null)=>db.query('select finish_kitchen_alert($1,$2,$3,$4,$5)',[row.id,row.claim_id,status,id,null]);
    await finish(first[0],'sent','101');await assert.rejects(()=>finish(first[0],'sent','101'),/claim changed/);
    await finish(first[1],'uncertain');await finish(second[0],'failed');
    await db.exec('reset role');await db.query("update kitchen_alert_deliveries set available_at=now()-interval '1 minute' where message_id=$1",[second[0].id]);await db.query("update kitchen_alert_deliveries set claimed_at=now()-interval '6 minutes' where message_id=$1",[second[1].id]);
    await db.exec('set role service_role');const retry=await claim(5);assert.equal(retry.length,1);assert.equal(retry[0].id,second[0].id);assert.notEqual(retry[0].claim_id,second[0].claim_id);await assert.rejects(()=>finish(second[0],'sent','102'),/claim changed/);
    await db.exec('reset role');assert.equal((await db.query('select status from kitchen_alert_deliveries where message_id=$1',[second[1].id])).rows[0].status,'uncertain');assert.equal((await db.query('select channel from outbound_messages where id=$1',[first[0].id])).rows[0].channel,'telegram');
    await db.exec("update notification_rules set enabled=false where code='kitchen.count_confirmed';insert into audit_logs(action,entity_type,entity_id,after_json) values('kitchen_stock_count','kitchen',gen_random_uuid(),'{\"items\":[]}');");assert.equal((await db.query('select count(*)::int n from kitchen_alert_deliveries')).rows[0].n,4);
    await db.exec("insert into outbound_messages(rule_code,title,body,status) values('kitchen.request_submitted','Skipped','Do not send','skipped');set role service_role");assert.equal((await claim(5)).length,0);
    await assert.rejects(()=>claim(0),/Invalid/);
    console.log('PASS: PostgreSQL triggers, confirmed-only events, permission isolation, atomic claims, no duplicate claims, verified completion, stale-claim rejection, uncertain crash recovery, explicit-failure retry, disabled rules and skipped messages.');
  }finally{await db.close();}
}
