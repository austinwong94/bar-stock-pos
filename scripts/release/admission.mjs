import ts from 'typescript';
import {readFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root,migrationFiles} from './database.mjs';
export async function walk(directory){
 const output=[];for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())output.push(...await walk(file));else output.push(file);}return output.sort();
}
export async function frontendInventory(){
 const pending=[path.join(root,'src/App.tsx')],seen=new Set(),calls=[],routes=[];
 while(pending.length){const file=pending.pop();if(seen.has(file))continue;seen.add(file);
  const source=await readFile(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const dependency=async(name)=>{if(!name.startsWith('.'))return;const base=path.resolve(path.dirname(file),name);for(const suffix of ['.ts','.tsx','/index.ts','/index.tsx']){try{if((await stat(base+suffix)).isFile()){pending.push(base+suffix);return;}}catch{}}};
  const dependencies=[];
  function visit(node){
   if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier))dependencies.push(node.moduleSpecifier.text);
   if(ts.isCallExpression(node)){
    if(node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0]))dependencies.push(node.arguments[0].text);
    const name=ts.isPropertyAccessExpression(node.expression)?node.expression.name.text:ts.isIdentifier(node.expression)?node.expression.text:'';
    if(name==='rpc'&&ts.isStringLiteral(node.arguments[0])){
      let mode='cloud';for(let branch=node;branch.parent;branch=branch.parent){const parent=branch.parent;if(ts.isIfStatement(parent)&&ts.isIdentifier(parent.expression)&&parent.expression.text==='isDemoMode'&&branch===parent.thenStatement){mode='sample';break;}}
      calls.push({file:path.relative(root,file),name:node.arguments[0].text,mode});
    }
   }
   if(ts.isJsxAttribute(node)&&node.name.getText(tree)==='path'&&node.initializer&&ts.isStringLiteral(node.initializer))routes.push(node.initializer.text);
   ts.forEachChild(node,visit);
  }
  visit(tree);for(const name of dependencies)await dependency(name);
 }
 return {files:[...seen].map(f=>path.relative(root,f)).sort(),calls,routes:[...new Set(routes)].sort()};
}
export async function sourceFingerprint(){
 const hash=createHash('sha256');const roots=['src','public','supabase','scripts','.github'];
 const files=[];for(const dir of roots)files.push(...await walk(path.join(root,dir)));
 for(const name of ['AGENTS.md','package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tailwind.config.js','postcss.config.js']){try{await stat(path.join(root,name));files.push(path.join(root,name));}catch{}}
 for(const file of [...new Set(files)].sort())hash.update(path.relative(root,file)+'\0').update(await readFile(file));
 return hash.digest('hex');
}
export async function admission(){
 const expected=JSON.parse(await readFile(path.join(root,'supabase/migration-checksums.json'),'utf8'));
 const files=await migrationFiles();if(files.length!==Object.keys(expected).length)throw new Error('Update the migration manifest by adding the new forward migration; never change an old checksum.');
 for(const file of files){const actual=createHash('sha256').update(await readFile(path.join(root,'supabase/migrations',file))).digest('hex');if(expected[file]!==actual)throw new Error('Migration checksum mismatch: '+file);}
 const inventory=await frontendInventory();
 const retired=new Set(['complete_sale','create_stock_in_draft','close_daily_report','record_kitchen_usage_checked','submit_kitchen_production_checked','save_expense_receipt']);
 for(const call of inventory.calls)if(retired.has(call.name))throw new Error('Active UI calls retired authority '+call.name+' in '+call.file);
 const productionKey=process.env.VITE_SUPABASE_ANON_KEY??'';
 if(productionKey.startsWith('sb_secret_')||productionKey.startsWith('sk-'))throw new Error('Frontend credentials must be a public Supabase key.');
 if(productionKey.split('.').length===3){try{const claims=JSON.parse(Buffer.from(productionKey.split('.')[1],'base64url').toString());if(claims.role==='service_role')throw new Error('A service-role key cannot enter the browser build.');}catch(error){if(error.message.includes('service-role'))throw error;}}
 return {source:await sourceFingerprint(),schemaFiles:files.length,lock:createHash('sha256').update(await readFile(path.join(root,'package-lock.json'))).digest('hex'),inventory};
}
