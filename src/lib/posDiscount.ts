export function cartDiscount(subtotal: number, rate: number | null, amount: string) {
  const requested = rate === null ? Number(amount) : subtotal * rate;
  return Math.round(Math.min(Math.max(0, subtotal), Math.max(0, Number.isFinite(requested) ? requested : 0)) * 100) / 100;
}
