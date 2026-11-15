import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['src/lib/productSetup.ts'],bundle:true,write:false,format:'cjs',platform:'node'});
const module={exports:{}};
new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {blankProductForm,parseProductForm,productFormIssues,productIssueLabel}=module.exports;
const blank=blankProductForm();
for(const key of ['name','category_id','price_per_unit','cost_per_unit','carton_size'])assert.equal(blank[key],'');
assert(!('quantity' in blank));
const valid={...blank,name:'Test Product',category_id:'fixture-category',price_per_unit:'12.50',carton_size:'24'};
assert.equal(parseProductForm(valid).payload.price_per_unit,12.5);
assert.equal(parseProductForm(valid).payload.cost_per_unit,null,'Unknown cost is not zero');
assert.equal(parseProductForm({...valid,price_per_unit:'0',carton_size:'1'}).payload.price_per_unit,0,'Only deliberately entered zero is accepted');
for(const key of ['name','category_id','price_per_unit','carton_size'])assert('error' in parseProductForm({...valid,[key]:''}),key+' is required');
for(const key of ['price_per_unit','cost_per_unit'])for(const value of ['-1','1.234','1e2','NaN','Infinity','123456789','1,000','1.'])assert('error' in parseProductForm({...valid,[key]:value}),key+': '+value);
for(const key of ['carton_size','low_stock_threshold'])for(const value of ['-1','1.2','1e2','2147483648','NaN'])assert('error' in parseProductForm({...valid,[key]:value}),key+': '+value);
assert('error' in parseProductForm({...valid,carton_size:'0'}));
assert.equal(parseProductForm({...valid,low_stock_threshold:'0'}).payload.low_stock_threshold,0);
assert.deepEqual(blankProductForm(),blank,'New records never inherit entered values');
const broken={...blank,name:' ',price_per_unit:'12.345',carton_size:'1.5',cost_per_unit:'-4',low_stock_threshold:'1e2'},original=structuredClone(broken);
const issues=productFormIssues(broken);assert.deepEqual(issues.map(i=>i.field),['name','category_id','price_per_unit','carton_size','cost_per_unit','low_stock_threshold']);
assert.deepEqual(broken,original,'Validation never strips or replaces raw input');
for(const issue of issues){assert.equal(productIssueLabel(issue,en=>en),issue.message);assert.notEqual(productIssueLabel(issue,(_,ms)=>ms),issue.message);assert(productIssueLabel(issue,(_,ms)=>ms).length>0);}
assert.deepEqual(productFormIssues(valid),[]);assert.equal(productFormIssues({...valid,cost_per_unit:'4.12',low_stock_threshold:'5'}).length,0);
for(const [field,value]of [['price_per_unit',' 12.345 '],['carton_size','24.0'],['low_stock_threshold','1.2'],['cost_per_unit','1.234']])assert(productFormIssues({...valid,[field]:value}).some(issue=>issue.field===field));
console.log('PASS product setup: deliberate category, exact RM prices, unknown cost, explicit carton conversion, no copied stock or silent rounding.');
