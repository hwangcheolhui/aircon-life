import 'server-only';
// 예약 스텝 공통: 로그인 확인(비회원은 휴대폰 인증 C-AUTH-030 으로) + 예약할 견적 불러오기
import { notFound } from 'next/navigation';
import { requireCustomer } from '@/server/customer-session';
import { loadReservableQuote } from '@/server/orders';

export async function reserveContext(quoteNo: string, r: string | undefined, step = '') {
  const self = `/reserve/${quoteNo}${step}${r ? `?r=${encodeURIComponent(r)}` : ''}`;
  const customer = await requireCustomer(self);
  const quote = await loadReservableQuote(quoteNo, r ?? null);
  if (!quote) notFound();
  return { customer, quote, r: r ?? null };
}
