export function reportMoneyCents(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d{1,10}(\.\d{1,2})?$/.test(String(value).trim())) {
    throw new Error('Sale amounts are incomplete or invalid. Reload the source records.');
  }
  const [whole, fraction = ''] = String(value).trim().split('.');
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}

// Largest remainders conserve cents without leaving a negative final line.
export function allocateMoney(total: unknown, weights: unknown[]): number[] {
  const cents = BigInt(reportMoneyCents(total));
  const values = weights.map(value => BigInt(reportMoneyCents(value)));
  const sum = values.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    if (cents !== 0n) throw new Error('Sale item amounts are missing. Reload the source records.');
    return values.map(() => 0);
  }
  const shares = values.map((weight, index) => ({ index, cents: cents * weight / sum, remainder: cents * weight % sum }));
  const remaining = Number(cents - shares.reduce((a, b) => a + b.cents, 0n));
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < remaining; i++) ranked[i].cents++;
  return shares.map(share => Number(share.cents) / 100);
}

export function allocateSaleItems(total: unknown, discount: unknown, lines: unknown[]) {
  const gross = lines.map(reportMoneyCents);
  if (BigInt(reportMoneyCents(total)) + BigInt(reportMoneyCents(discount)) !== gross.reduce((a, b) => a + BigInt(b), 0n)) {
    throw new Error('Sale totals and item amounts do not match. Reload the source records.');
  }
  const discounts = allocateMoney(discount, lines);
  const netLines = gross.map((cents, index) => (cents - reportMoneyCents(discounts[index])) / 100);
  return { netLines, discounts };
}
