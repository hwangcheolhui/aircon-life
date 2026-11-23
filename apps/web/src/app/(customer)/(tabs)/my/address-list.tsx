'use client';
// C-MY-010 주소록 (삭제는 확인 후 소프트 삭제)
import { Button, ConfirmModal, Empty, Tag } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { removeAddress } from './actions';

export function AddressList({ addresses }: { addresses: { id: number; text: string; isDefault: boolean; housing: string | null }[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<number | null>(null);
  const [pending, start] = useTransition();
  if (addresses.length === 0) return <Empty>저장된 주소가 없어요. 예약하면 방문 주소가 저장돼요.</Empty>;
  return (
    <>
      <ul className="ac-list">
        {addresses.map((a) => (
          <li key={a.id} className="ac-list-item">
            <div className="ac-list-item__body">
              <span className="ac-body">{a.text}</span>
              <div className="ac-caption">
                {a.isDefault ? <Tag tone="primary">기본</Tag> : null} {a.housing}
              </div>
            </div>
            <Button variant="text" size="sm" onClick={() => setTarget(a.id)} disabled={pending}>
              삭제
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmModal
        open={target !== null}
        message="주소를 삭제하시겠습니까?"
        confirmLabel="삭제"
        danger
        onCancel={() => setTarget(null)}
        onConfirm={() =>
          start(async () => {
            if (target) await removeAddress(target);
            setTarget(null);
            router.refresh();
          })
        }
      />
    </>
  );
}
