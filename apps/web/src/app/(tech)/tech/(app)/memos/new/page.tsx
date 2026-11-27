// T-MEMO-010 메모 등록 · F-TEC-MEMO-01 (캘린더·홈 오늘의 메모·퀵메뉴에서 진입, ?date= 로 시작일 지정)
import { kstDate } from '@aircon/domain';
import { loadCodes } from '@/server/codes';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { MemoForm } from '../memo-form';

export const metadata = { title: '메모 등록' };

export default async function TechMemoNewPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireTech();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : kstDate(new Date());
  const codes = await loadCodes(['MEMO_HEADER', 'MEMO_REPEAT']);
  const back = `/tech/calendar?month=${date.slice(0, 7)}&date=${date}&mode=memo`;
  return (
    <main className="tec-page__body">
      <TechTopbar title="메모 등록" back={{ href: back, label: '캘린더로' }} />
      <MemoForm
        backHref={back}
        headers={codes.MEMO_HEADER ?? []}
        repeats={codes.MEMO_REPEAT ?? []}
        initial={{ headerCode: 'MANUAL', content: '', startDate: date, endDate: date, repeatType: 'NONE', relatedOrderNo: '' }}
      />
    </main>
  );
}
