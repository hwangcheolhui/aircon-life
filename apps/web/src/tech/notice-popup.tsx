'use client';
// T-HOM-010 팝업 공지 (F-TEC-HOM-01): 읽지 않은 팝업 공지를 첫 화면에 띄우고 [확인]하면 읽음 처리(필독 확인)
import { Button, Modal } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { confirmNotice } from '@/app/(tech)/tech/(app)/aftercare-actions';

export function NoticePopup({ notice }: { notice: { id: number; title: string; content: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const ok = async () => {
    setBusy(true);
    await confirmNotice(notice.id);
    setBusy(false);
    setOpen(false);
    router.refresh();
  };
  return (
    <Modal
      open={open}
      title={notice.title}
      onClose={() => setOpen(false)}
      actions={
        <Button variant="primary" size="lg" block loading={busy} onClick={ok}>
          확인했습니다
        </Button>
      }
    >
      <p className="ac-body tec-notice-body">{notice.content}</p>
    </Modal>
  );
}
