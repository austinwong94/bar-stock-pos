import pg from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function migrationFiles(){return (await readdir(path.join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort();}
export async function migrationFingerprint(){
  const files=await migrationFiles(),hash=createHash('sha256');
  for(const file of files)hash.update(file+'\0').update(await readFile(path.join(root,'supabase/migrations',file)));
  return hash.digest('hex');
}
export async function applyMigrations(db,files){for(const file of files){
  try{await db.query(await readFile(path.join(root,'supabase/migrations',file),'utf8'));}
  catch(error){throw new Error('Migration '+file+' failed ('+error.code+'): '+error.message,{cause:error});}
}}
export async function withDatabase(run,{through=null,seed=true,bootstrap=null}={}){
  const url=new URL(process.env.TEST_PG_URL??'postgres://postgres:postgres@127.0.0.1:5432/postgres');
  if(!['localhost','127.0.0.1','[::1]','postgres'].includes(url.hostname))throw new Error('Disposable database tests accept local PostgreSQL only.');
  const database='lp_audit_'+randomUUID().replaceAll('-',''),admin=new pg.Client({connectionString:url.toString()});
  const ownedUrl=new URL(url);ownedUrl.pathname='/'+database;
  const clients=new Set();let created=false;
  const connect=async()=>{const client=new pg.Client({connectionString:ownedUrl.toString()});await client.connect();clients.add(client);await client.query("set statement_timeout='20s';set lock_timeout='5s'");return client;};
  await admin.connect();
  try{
    await admin.query('create database '+database);created=true;
    const db=await connect();await db.query(await readFile(path.join(root,'supabase/tests/harness.sql'),'utf8'));
    const files=await migrationFiles();
    if(bootstrap){
      await applyMigrations(db,files.slice(0,1));
      await db.query('create schema extensions; alter extension pgcrypto set schema extensions');
      await db.query(await readFile(bootstrap,'utf8'));
    }else await applyMigrations(db,files.filter(f=>!through||f<=through));
    if(seed)await db.query(await readFile(path.join(root,'supabase/tests/seed_test.sql'),'utf8'));
    return await run(db,connect,files);
  }finally{
    await Promise.allSettled([...clients].map(c=>c.end()));
    if(created)await admin.query('drop database '+database);
    await admin.end();
  }
}
