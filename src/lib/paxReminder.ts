export function paxReminderSlot(now: Date, enteredAt: Date, businessDate: string): '10' | '12' | null {
  // Only reminders reached after entering the platform may interrupt the user.
  for (const slot of ['12', '10'] as const) {
    const scheduledAt = new Date(`${businessDate}T${slot}:00:00+08:00`).getTime();
    if (scheduledAt > enteredAt.getTime() && scheduledAt <= now.getTime()) return slot;
  }
  return null;
}
