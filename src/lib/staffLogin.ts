export const staffLoginDomain = 'staff.lovely-paradise.invalid';

export function staffLoginEmail(value: string): string {
  const login = value.trim().toLowerCase();
  if (login.includes('@')) return login;
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(login)) {
    throw new Error('Use 3-40 letters, numbers, dots, underscores or hyphens for the username.');
  }
  return `${login}@${staffLoginDomain}`;
}

export function staffLoginLabel(email: string | null): string {
  return email?.endsWith(`@${staffLoginDomain}`) ? email.slice(0, -staffLoginDomain.length - 1) : email ?? '';
}
