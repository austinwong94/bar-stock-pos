export function passengerLabel(age: string, text: (en: string, ms: string) => string) {
  if (age === 'child') return text('Child', 'Kanak-kanak');
  if (age === 'infant') return text('Infant', 'Bayi');
  // Legacy elderly records are adults, never infants.
  return text('Adult', 'Dewasa');
}
