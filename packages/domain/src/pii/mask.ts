/**
 * 개인정보 마스킹 (ERD §6, BR-100): 이름 `김*빈`, 전화 `010-****-7789`.
 * 브라우저에서도 쓰므로 Node 전용 API를 쓰지 않는다.
 */

export function maskName(name: string | null | undefined): string {
  if (!name) return '';
  const chars = Array.from(name.trim());
  if (chars.length <= 1) return chars.join('');
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const d = normalizePhone(phone);
  if (d.length < 7) return '*'.repeat(d.length);
  const head = d.startsWith('02') ? d.slice(0, 2) : d.slice(0, 3);
  const tail = d.slice(-4);
  const midLen = d.length - head.length - 4;
  return `${head}-${'*'.repeat(midLen)}-${tail}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain || !local) return '*'.repeat(email.length);
  return `${local.slice(0, Math.min(2, local.length))}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}
