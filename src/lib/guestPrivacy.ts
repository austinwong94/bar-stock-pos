export type GuestPrivacyRule = {
  user_id: string; name: string; role: string; agency: string | null; restricted: boolean;
  master: boolean; mode: 'contacts' | 'names_contacts' | 'history'; hide_after_days: number;
  version: number; updated_at: string | null; updated_by: string | null; finance_allowed: boolean;
};
export type PrivacyFlags = { contacts_hidden?: boolean; names_hidden?: boolean };

export function privacyFlags(date: string | null, today: string, rule: Pick<GuestPrivacyRule, 'mode' | 'hide_after_days'>, historyAllowed: boolean): PrivacyFlags {
  const expired = !historyAllowed && (!date || Date.parse(today) >= Date.parse(date) + rule.hide_after_days * 86400000);
  return { contacts_hidden: expired, names_hidden: expired && rule.mode === 'names_contacts' };
}

const privateFields = new Set(['lead_phone','lead_email','phone','email','passport_no','date_of_birth','tourist_private','notes','note','ops_notes','special_requests','external_ref','assistance_note','seat_note','medical_notes','dietary_notes','remarks','reference','void_reason']);
export function redactGuest(value: any, flags: PrivacyFlags): any {
  if (!flags.contacts_hidden || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redactGuest(item, flags));
  return Object.fromEntries([...Object.entries(value).map(([key, item]) => [key,
    privateFields.has(key) ? null : flags.names_hidden && ['lead_name','full_name'].includes(key) ? 'Private guest' : redactGuest(item, flags)]), ...Object.entries(flags)]);
}
