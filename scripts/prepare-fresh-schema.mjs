import {spawn} from 'node:child_process';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {withDatabase,migrationFingerprint,root} from './release/database.mjs';

const quote=v=>'"'+v.replaceAll('"','""')+'"';
const literal=v=>"'"+v.replaceAll("'","''")+"'";
const dump=(url,args)=>new Promise((resolve,reject)=>{
  const c=spawn(process.env.PG_DUMP_PATH??'pg_dump',['--dbname',url,'--no-owner','--no-comments',...args],{env:{...process.env,PGPASSWORD:'postgres'},stdio:['ignore','pipe','pipe']});
  let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',code=>code?reject(Error(err)):resolve(out.split('\n').filter(l=>!l.startsWith('\\')).join('\n')));
});
await mkdir(root+'/.qa/release',{recursive:true});
await withDatabase(async db=>{
  assert.equal(Number((await db.query('select count(*) n from auth.users')).rows[0].n),0);
  await db.query('create schema if not exists extensions; alter extension pgcrypto set schema extensions');
  await db.query(await readFile(root+'/supabase/migrations/20261016230746_hosted_crypto_search_path.sql','utf8'));
  await db.query("insert into app_settings(key,value) values('allow_access_code_login','false') on conflict(key) do update set value='false'");
  const url='postgres://postgres@127.0.0.1:55441/'+db.database;
  const schema=await dump(url,['--schema-only','--schema=public','--schema=private_guest','--no-privileges']);
  const reference=['departments','access_roles','permissions','access_role_permissions','app_settings','categories','activity_types','item_catalogue','referral_settings','booking_privacy_settings','receipt_ai_settings','kitchen_alert_settings'];
  const tables=(await db.query("select tablename from pg_tables where schemaname='public'")).rows.map(r=>r.tablename);
  const selected=reference.filter(t=>tables.includes(t));
  const data=await dump(url,['--data-only','--column-inserts',...selected.flatMap(t=>['--table','public.'+t])]);
  const buckets=(await db.query('select * from storage.buckets order by id')).rows;
  // pg_dump clears the session search path; identity arguments below include
  // application composite types, so restore their known schema before grants.
  let attachments="select pg_catalog.set_config('search_path','public,extensions,pg_temp',false);\ngrant usage on schema public to anon,authenticated,service_role;\nrevoke all on schema private_guest from public,anon,authenticated;\nrevoke all on all functions in schema private_guest from public,anon,authenticated;\n";
  // Export effective current grants, not the permissive default ACLs of the fixture.
  // Anonymous users get only the public deployment probe, never business APIs.
  const functions=(await db.query("select format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) signature,p.proname,has_function_privilege('authenticated',p.oid,'EXECUTE') staff from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by p.oid")).rows;
  for(const f of functions){attachments+=`revoke all on function ${f.signature} from public,anon,authenticated;\ngrant execute on function ${f.signature} to service_role;\n`;if(f.staff)attachments+=`grant execute on function ${f.signature} to authenticated;\n`;if(f.proname==='read_platform_schema_version')attachments+=`grant execute on function ${f.signature} to anon;\n`;}
  for(const table of tables){
    const privileges=[];
    for(const permission of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])if((await db.query('select has_table_privilege($1,$2,$3) allowed',['authenticated','public.'+table,permission])).rows[0].allowed)privileges.push(permission);
    attachments+=`grant all on public.${quote(table)} to service_role;\n`;
    if(privileges.length)attachments+=`grant ${privileges.join(',')} on public.${quote(table)} to authenticated;\n`;
  }
  const columns=(await db.query("select c.relname,a.attname,x.privilege_type from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) x join pg_roles r on r.oid=x.grantee where n.nspname='public' and r.rolname='authenticated'")).rows;
  for(const c of columns)attachments+=`grant ${c.privilege_type}(${quote(c.attname)}) on public.${quote(c.relname)} to authenticated;\n`;
  const sequences=(await db.query("select c.relname,has_sequence_privilege('authenticated',c.oid,'USAGE') staff from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'")).rows;
  for(const s of sequences)attachments+=`grant all on sequence public.${quote(s.relname)} to service_role;\n${s.staff?'grant usage,select on sequence public.'+quote(s.relname)+' to authenticated;\n':''}`;
  const views=(await db.query("select c.relname,has_table_privilege('authenticated',c.oid,'SELECT') staff from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')")).rows;
  for(const v of views)attachments+=`grant all on public.${quote(v.relname)} to service_role;\n${v.staff?'grant select on public.'+quote(v.relname)+' to authenticated;\n':''}`;
  for(const b of buckets){
    attachments+=`insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(${literal(b.id)},${literal(b.name)},${b.public},${b.file_size_limit??'null'},${b.allowed_mime_types?'array['+b.allowed_mime_types.map(literal).join(',')+']::text[]':'null'}) on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;\n`;
  }
  const policies=(await db.query("select p.*,p.roles::text[] policy_roles from pg_policies p where schemaname='storage' order by policyname")).rows;
  for(const p of policies){attachments+=`drop policy if exists ${quote(p.policyname)} on storage.${quote(p.tablename)};\ncreate policy ${quote(p.policyname)} on storage.${quote(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.policy_roles.map(r=>r==='public'?'public':quote(r)).join(',')}${p.qual?' using ('+p.qual+')':''}${p.with_check?' with check ('+p.with_check+')':''};\n`;}
  const triggers=(await db.query("select pg_get_triggerdef(t.oid) definition,n.nspname,c.relname,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','storage') and not t.tgisinternal order by n.nspname,t.tgname")).rows;
  for(const t of triggers)attachments+=`drop trigger if exists ${quote(t.tgname)} on ${quote(t.nspname)}.${quote(t.relname)};\n${t.definition};\n`;
  const preflight=`do $$begin
    if (select count(*) from auth.users)<>0 or (select count(*) from public.profiles)<>0
      or (select count(*) from public.sales)<>0 or (select count(*) from public.products)<>0
      or (select count(*) from public.stock_movements)<>0 then
      raise exception 'Fresh installation refused: existing accounts or business records must be preserved.';
    end if;
    if exists(select 1 from pg_tables where schemaname='public' and tablename not in
      ('profiles','categories','products','inventory_balances','stock_movements','sales','sale_items',
       'cash_sessions','daily_reports','app_settings','audit_logs','product_price_history')) then
      raise exception 'Fresh installation refused: unexpected existing application tables.';
    end if;
  end;$$;\n`;
  const sql='-- Fresh empty-project install of the FINAL permission-checked schema, not unsafe historical access grants.\n'+preflight+'drop schema public cascade;\n'+schema+'\n'+data+'\n'+attachments+'\nset row_security=on;\nset check_function_bodies=on;\n';
  await writeFile(root+'/.qa/release/fresh-schema.sql',sql);
  await writeFile(root+'/.qa/release/fresh-schema.json',JSON.stringify({schema:await migrationFingerprint(),sha256:createHash('sha256').update(sql).digest('hex'),bytes:Buffer.byteLength(sql),referenceTables:selected,authUsers:0,profiles:0,products:0,sales:0},null,2));
  console.log('Generated final secure schema with no accounts, products, purchases, sales or stock balances. '+Buffer.byteLength(sql)+' bytes.');
},{seed:false});
