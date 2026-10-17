import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const paths = [];
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.text === 'path' && node.initializer && ts.isStringLiteral(node.initializer)) paths.push(node.initializer.text);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.deepEqual(paths.sort(), [
  '/login','/bar','/pos','/stock-in','/stock-out-report','/inventory','/products',
  '/daily-closing','/daily-report','/sales','/movements','/settings','/users',
  '/kitchen','/kitchen/stock','/kitchen/purchases','/purchasing',
  '/kitchen/meal-needs','/kitchen/preparation','/admin/access','*',
].sort(), 'Only rollout routes and explicit legacy redirects are registered');
assert.match(app, /path="\*" element={<UnavailableSection/);
assert.match(app, /to={'\/kitchen\/purchases' \+ search}/, 'Purchase bookmarks retain their view');
assert.doesNotMatch(app, /lazy\(\(\) => import\('.\/pages\/(guests|fleet|ops|items)/);

const navigation = read('src/lib/navigation.ts');
const departments = navigation.slice(navigation.indexOf('export const departmentNav'), navigation.indexOf('/**', navigation.indexOf('export const departmentNav')));
assert.deepEqual([...departments.matchAll(/code: '([^']+)'/g)].map(m => m[1]), ['kitchen','bar']);
assert.match(read('src/lib/access.tsx'), /\['kitchen', 'bar'\]\.includes/);
const stock = read('src/pages/supply/KitchenStock.tsx');
assert.match(stock, /\['usage','water','out'\]\.includes\(tab\)/, 'All usage panes share their navigation');
assert.doesNotMatch(stock, /onSaved=[^\n]*setTab\('history'\)/, 'Saving waste does not jump to History');
for (const tab of ['usage','water','out']) assert(stock.includes("hidden={tab!=='" + tab + "'}"), tab + ' entry stays mounted across switches');
assert.match(read('src/pages/supply/PurchasingWorkspace.tsx'), /<KitchenHeader\/>/);
assert.doesNotMatch(read('src/pages/supply/DailyKitchenUsage.tsx'), /onWaste/);
assert.match(read('src/components/AppUpdateNotice.tsx'), /cache: 'no-store'/);
assert.match(read('src/components/AppUpdateNotice.tsx'), /window.confirm/, 'Updates never silently discard entries');
console.log('PASS: two-workspace route allowlist, legacy redirects, stable usage panes, shared Kitchen header, explicit update handling.');
