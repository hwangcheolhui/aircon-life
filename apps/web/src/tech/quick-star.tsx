'use client';
// T-MORE-010 메뉴 옆 ★: 누르면 바로 퀵메뉴에 추가·해제 (F-TEC-HOM-04)
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toggleQuickMenuAction } from '@/app/(tech)/tech/(app)/support-actions';

export function QuickStar({ code, name, on }: { code: string; name: string; on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`tec-star tec-star--corner${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={`${name} 퀵메뉴 ${on ? '해제' : '추가'}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await toggleQuickMenuAction(code);
          router.refresh();
        })
      }
    >
      <Star aria-hidden />
    </button>
  );
}
