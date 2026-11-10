import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {root,withDatabase} from '../../scripts/release/database.mjs';

const file='20261110170733_harden_browser_table_privileges.sql';
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const forbidden=['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
const ordinary=['SELECT','INSERT','UPDATE','DELETE'];

async function tables(db){return (await db.query("select c.oid,n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname")).rows;}
async function records(db,relations){
  const result=[];
  for(const table of relations){
    const {rows}=await db.query(`select count(*)::int count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) digest from ${quote(table.nspname)}.${quote(table.relname)} t`);
    result.push({table:table.relname,...rows[0]});
  }
  return result;
}
async function access(db,relations,roles,permissions){
  const result=[];
  for(const table of relations)for(const role of roles)for(const permission of permissions){
    result.push({table:table.relname,role,permission,allowed:(await db.query('select has_table_privilege($1::name,$2::oid,$3::text) allowed',[role,table.oid,permission])).rows[0].allowed});
  }
  return result;
}

export async function runDatabasePrivilegeTests(){
  const migration=await readFile(root+'/supabase/migrations/'+file,'utf8');
  await withDatabase(async db=>{
    assert((await access(db,await tables(db),['anon','authenticated'],forbidden)).every(p=>!p.allowed),'The complete current migration chain must retain least-privilege access');
  });
  await withDatabase(async db=>{
    const relations=await tables(db),before=await records(db,relations);
    const businessAccess=await access(db,relations,['anon','authenticated','service_role'],ordinary);
    const serviceAccess=await access(db,relations,['service_role'],forbidden);
    const helpers=(await db.query("select proname,prosrc,prosecdef,provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('touch_updated_at','distance_km') order by proname")).rows;
    // Deliberately overgrant only in this disposable database to exercise PUBLIC inheritance too.
    await db.query('grant truncate,references,trigger,maintain on all tables in schema public to public,anon,authenticated');
    await db.query('alter default privileges in schema public grant truncate,references,trigger,maintain on tables to public,anon,authenticated');
    assert((await access(db,relations,['authenticated'],['TRUNCATE'])).some(p=>p.allowed),'The fixture must reproduce the overgrant');
    await db.query(migration);
    assert((await access(db,relations,['anon','authenticated'],forbidden)).every(p=>!p.allowed),'No table-wide administration through browser roles or PUBLIC');
    assert.deepEqual(await access(db,relations,['anon','authenticated','service_role'],ordinary),businessAccess,'Preserve ordinary effective privileges');
    assert.deepEqual(await access(db,relations,['service_role'],forbidden),serviceAccess,'Preserve server administration rights');
    assert.deepEqual(await tables(db),relations,'Keep RLS and table identities unchanged');
    assert.deepEqual(await records(db,relations),before,'No account, stock, sale, request, purchase or audit row changes');
    assert.deepEqual((await db.query("select proname,prosrc,prosecdef,provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('touch_updated_at','distance_km') order by proname")).rows,helpers);
    const configs=(await db.query("select proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('touch_updated_at','distance_km')")).rows;
    assert(configs.every(p=>p.proconfig.includes('search_path=pg_catalog, pg_temp')));
    await db.query(migration);
    assert.deepEqual(await records(db,relations),before,'Replaying hardening is non-destructive');

    await db.query(`create table public.lp_privilege_probe(id integer primary key,updated_at timestamptz not null default now());
      insert into public.lp_privilege_probe(id) values(42);
      create trigger lp_probe_touch before update on public.lp_privilege_probe for each row execute function public.touch_updated_at();
      create table public.lp_fk_probe(id integer primary key,parent_id integer);
      alter table public.lp_fk_probe owner to authenticated;
      create schema lp_shadow;
      grant usage on schema lp_shadow to authenticated;
      create function lp_shadow.now() returns timestamptz language sql as $$select '2000-01-01'::timestamptz$$;
      create function lp_shadow.radians(numeric) returns double precision language sql as $$select 0::double precision$$;`);
    const probe=(await db.query("select c.oid,n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='lp_privilege_probe'")).rows;
    assert((await access(db,probe,['anon','authenticated'],forbidden)).every(p=>!p.allowed),'Future tables do not inherit the old administrative grants');
    await db.query('set role authenticated');
    for(const sql of ['truncate public.lp_privilege_probe','create trigger lp_unauthorised before update on public.lp_privilege_probe for each row execute function public.touch_updated_at()','alter table public.lp_fk_probe add constraint lp_unauthorised_fk foreign key(parent_id) references public.lp_privilege_probe(id)']){
      await assert.rejects(()=>db.query(sql),error=>error.code==='42501','Deny '+sql);
    }
    assert.equal((await db.query('select count(*)::int n from public.lp_privilege_probe')).rows[0].n,1);
    await db.query('set search_path=lp_shadow,public,pg_catalog');
    assert.equal(Number((await db.query('select public.distance_km(0,0,0,1) distance')).rows[0].distance),111.195,'Caller search paths cannot substitute distance math');
    await db.query('update public.lp_privilege_probe set id=id where id=42');
    assert((await db.query("select updated_at > '2001-01-01'::timestamptz and abs(extract(epoch from (pg_catalog.clock_timestamp()-updated_at)))<5 safe from public.lp_privilege_probe")).rows[0].safe,'Timestamp trigger uses the real built-in clock');
    await db.query('reset role;reset search_path');
    assert.deepEqual(await records(db,relations),before,'Denied actions and helper checks leave all business records untouched');
  },{through:'20261017001732_restore_standard_kitchen_catalogue.sql'});
  console.log('PASS native database hardening: inherited/PUBLIC administrative rights removed, ordinary and service access preserved, future-table defaults safe, denied truncate/trigger/foreign-key actions, fixed helper resolution, replay and unchanged business rows.');
}
