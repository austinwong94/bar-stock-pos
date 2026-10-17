import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/delivery.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { fixedDeliveryUnit, deliveryLineError } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
assert.deepEqual(fixedDeliveryUnit(' KG '), { baseUnit: 'g', size: 1000 });
assert.deepEqual(fixedDeliveryUnit('L'), { baseUnit: 'ml', size: 1000 });
assert.deepEqual(fixedDeliveryUnit('pcs'), { baseUnit: 'unit', size: 1 });
assert.equal(fixedDeliveryUnit('bottle'), null, 'Bottle sizes are never guessed');
assert.equal(fixedDeliveryUnit('pack'), null, 'Packet sizes are never guessed');
const cases = [
  ['kg', 'g', 3.5, 1000, 10, null],
  ['bottle', 'ml', 2, 500, 10, null],
  ['bottle', 'ml', 1, 1000, 8, null],
  ['l', 'ml', 0.25, 1000, 10, null],
  ['pack', 'unit', 0.5, 12, 10, null],
  ['pcs', 'unit', 0.5, 1, 10, 'whole'],
  ['kg', 'ml', 1, 1000, 10, 'unit'],
  ['kg', 'g', 1, 500, 10, 'unit'],
  ['kg', 'g', 0, 1000, 10, 'quantity'],
  ['kg', 'g', 0.001, 1000, 10, 'quantity'],
  ['kg', 'g', 11, 1000, 10, 'exceeds'],
  ['pack', 'g', 1, 0, 10, 'size'],
  ['pack', 'g', 1, 0.00001, 10, 'size'],
  ['pack', 'g', 1, 0.0001, 10, 'precision'],
  ['pack', 'g', 1, 1e12, 10, 'precision'],
  ['bottle', 'ml', NaN, 500, 10, 'quantity'],
  ['bottle', 'ml', 1, Infinity, 10, 'size'],
  ['kg', 'g', 0.29, 1000, 10, null],
];
for (const [unit, base, quantity, size, remaining, expected] of cases) {
  assert.equal(deliveryLineError(unit, base, quantity, size, remaining), expected, `${quantity} ${unit} with ${size} ${base} per unit`);
}
console.log(`PASS ${cases.length + 5} delivery-unit checks: fixed conversions, variable packs, whole units, decimal precision and invalid values`);
