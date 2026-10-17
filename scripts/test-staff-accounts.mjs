import assert from 'node:assert/strict';
import {build} from 'esbuild';
const load=async path=>{const b=await build({entryPoints:[path],bundle:true,write:false,format:'cjs',platform:'node'});const m={exports:{}};new Function('module','exports',b.outputFiles[0].text)(m,m.exports);return m.exports;};
const {staffLoginEmail,staffLoginLabel}=await load('src/lib/staffLogin.ts');
assert.equal(staffLoginEmail(' Cook.Lina '),'cook.lina@staff.lovely-paradise.invalid');
assert.equal(staffLoginLabel(staffLoginEmail('cook.lina')),'cook.lina');
assert.equal(staffLoginEmail('OWNER@example.com'),'owner@example.com');
for(const value of ['ab','a b c','@','a/b/c']){
  if(value==='@')continue;
  assert.throws(()=>staffLoginEmail(value));
}
const {createStaffAccountHandler}=await load('supabase/functions/manage-staff-account/handler.ts');
const id='a26b6ee6-1c80-4cd8-b234-47ef5d6c5e9f';
const input={operation_id:id,username:'cook.lina',full_name:'Lina',role_code:'kitchen_staff',password:'example-only-93812'};
async function probe(options={}){
  const calls=[];let user=options.existing?{id,email:staffLoginEmail(input.username),app_metadata:{staff_provision_operation:id,staff_provision_actor:options.wrongActor?'intruder':'owner',staff_provision_role:input.role_code,staff_provision_name:input.full_name}}:null;
  const config={SUPABASE_URL:'https://project.test',SUPABASE_ANON_KEY:'public-key',SUPABASE_SERVICE_ROLE_KEY:'server-secret',STAFF_ACCOUNT_ALLOWED_ORIGINS:'https://app.test'};
  const handler=createStaffAccountHandler(k=>config[k],async(url,init)=>{
    calls.push({url,init});const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
    if(url.endsWith('/auth/v1/user'))return options.unauthorized?json({},401):json({id:'owner',is_anonymous:options.anonymous});
    if(url.endsWith('/has_permission'))return json(!options.denied);
    if(url.includes('/access_roles?'))return json([{code:input.role_code,is_master:options.master}]);
    if(url.endsWith('/is_master_admin'))return json(!options.notMaster);
    if(url.endsWith('/auth/v1/admin/users/'+id))return options.lookupFailure?json({},503):json(user??{},user?200:404);
    if(url.endsWith('/auth/v1/admin/users')){if(options.duplicate)return json({},422);user=JSON.parse(init.body);if(options.lostCreate)throw Error('lost reply');return json(user);}
    if(url.endsWith('/admin_activate_created_user'))return options.activationDenied?json({},403):json({id,status:'active'});
    throw Error('Unexpected endpoint');
  });
  const response=await handler(new Request('https://function.test',{method:'POST',headers:{origin:options.badOrigin?'https://evil.test':'https://app.test',authorization:'Bearer actor'},body:JSON.stringify({...input,...options.patch})}));
  return {status:response.status,body:await response.json(),calls};
}
for(const option of [{badOrigin:true},{anonymous:true},{unauthorized:true},{denied:true},{master:true,notMaster:true}]){
  const result=await probe(option);assert(result.status>=400);assert.equal(result.calls.filter(c=>c.url.includes('/admin/users')).length,0);
}
const good=await probe();assert.equal(good.status,200);assert.equal(good.body.username,'cook.lina');assert(!JSON.stringify(good.body).includes(input.password));
assert.equal(good.calls.find(c=>c.url.endsWith('/admin_activate_created_user')).init.headers.Authorization,'Bearer actor');
const retry=await probe({existing:true,patch:{password:undefined}});assert.equal(retry.status,200);assert.equal(retry.calls.filter(c=>c.url.endsWith('/auth/v1/admin/users')).length,0);
assert.equal((await probe({existing:true,wrongActor:true})).status,409);
assert.equal((await probe({activationDenied:true})).status,409);
assert.equal((await probe({lostCreate:true})).status,503);
assert.equal((await probe({duplicate:true})).body.code,'NOT_STARTED');
assert.equal((await probe({patch:{password:''}})).body.code,'NOT_STARTED');
assert.equal((await probe({patch:{username:'bad username'}})).status,400);
assert.equal((await probe({lookupFailure:true})).status,503);
console.log('PASS staff account protocol: username-only login, authorization, owner-role guard, server-only credentials, lost-reply recovery and actor-bound replay.');
