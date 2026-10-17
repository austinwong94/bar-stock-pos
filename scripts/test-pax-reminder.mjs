import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/paxReminder.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { paxReminderSlot } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const date = '2026-09-21';
const at = time => new Date(`${date}T${time}:00+08:00`);
for (const time of ['08:00', '10:00', '10:30', '12:00', '15:00', '23:59']) {
  assert.equal(paxReminderSlot(at(time), at(time), date), null, `No entry popup at ${time}`);
}
assert.equal(paxReminderSlot(at('08:01'), at('08:00'), date), null);
assert.equal(paxReminderSlot(at('10:31'), at('10:30'), date), null, 'No delayed catch-up popup after entry');
assert.equal(paxReminderSlot(at('15:01'), at('15:00'), date), null);
assert.equal(paxReminderSlot(at('10:00'), at('09:59'), date), '10');
assert.equal(paxReminderSlot(at('12:00'), at('11:59'), date), '12');
assert.equal(paxReminderSlot(at('12:01'), at('08:00'), date), '12', 'Choose latest scheduled reminder');
assert.equal(paxReminderSlot(new Date('2026-09-21T02:00:00Z'), at('09:59'), date), '10', 'Use Malaysia time');
assert.equal(paxReminderSlot(new Date('2026-09-22T00:00:00+08:00'), at('23:59'), '2026-09-22'), null);
assert.equal(paxReminderSlot(new Date('2026-09-22T10:00:00+08:00'), at('23:59'), '2026-09-22'), '10');
console.log('PASS: no entry/catch-up popup; 10am/noon reminders and next-day boundaries preserved.');
