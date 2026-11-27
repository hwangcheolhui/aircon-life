// T-MEMO-010 메모 수정·삭제 · F-TEC-MEMO-01 (내가 쓴 메모만. 관리자가 보낸 지정 메모는 수정할 수 없다)
import { notFound } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { getTechMemo } from '@/server/tech-memos';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { MemoForm } from '../memo-form';

export const metadata = { title: '메모 수정' };

export default async function TechMemoEditPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTech();
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();
  const [m, codes] = await Promise.all([getTechMemo(me, Number(id)), loadCodes(['MEMO_HEADER', 'MEMO_REPEAT'])]);
  if (!m) notFound();
  const back = `/tech/calendar?month=${m.startDate.slice(0, 7)}&date=${m.startDate}&mode=memo`;
  return (
    <main className="tec-page__body">
      <TechTopbar title="메모 수정" back={{ href: back, label: '캘린더로' }} />
      <MemoForm
        backHref={back}
        headers={codes.MEMO_HEADER ?? []}
        repeats={codes.MEMO_REPEAT ?? []}
        initial={{
          id: m.id,
          headerCode: m.headerCode ?? 'MANUAL',
          content: m.content,
          startDate: m.startDate,
          endDate: m.endDate,
          repeatType: m.repeatType,
          relatedOrderNo: m.relatedOrderNo ?? '',
        }}
      />
    </main>
  );
}
