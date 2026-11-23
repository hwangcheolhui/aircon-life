'use server';
// A-PRD-050 견적 시뮬레이터 · F-ADM-PRD-05 — 고객 견적(F-CUS-QUO-04)과 같은 computeQuote 를 거쳐 같은 결과를 낸다. 저장하지 않는다.
import { quoteSimulationInput } from '@aircon/contracts';
import { quoteFailureMessage } from '@aircon/domain';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { computeQuote } from '@/server/quote';

export async function simulateQuote(input: unknown) {
  return handle(async () => {
    await requirePermission('A-PRD-050', 'READ');
    const q = parse(quoteSimulationInput, input);
    const r = await computeQuote({
      legalDongCode: q.legalDongCode,
      lines: q.lines,
      options: q.options,
      customerType: q.customerType,
      visit: q.visitDate && q.visitTime ? { date: q.visitDate, time: q.visitTime.slice(0, 5) } : null,
    });
    if (!r.ok) return { ok: false as const, message: quoteFailureMessage(r) };
    return {
      ok: true as const,
      subtotalAmount: r.subtotalAmount,
      discountAmount: r.discountAmount,
      surchargeAmount: r.surchargeAmount,
      totalAmount: r.totalAmount,
      estimatedDurationMin: r.estimatedDurationMin,
      needsSiteSurvey: r.needsSiteSurvey,
      snapshot: r.snapshot,
    };
  });
}
