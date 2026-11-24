'use client';
// T-JOB-020 동작: [연락처·상세주소 보기](감사 로그) · [길찾기] · [전화] · [이관 요청](F-TEC-JOB-05)
import { Alert, Button, Field, Modal, Textarea, useToast } from '@aircon/ui';
import { Navigation, Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { requestJobTransfer, revealJobContact } from '../../actions';

export function ContactReveal({
  orderNo,
  phoneMasked,
  roadAddress,
}: {
  orderNo: string;
  phoneMasked: string;
  roadAddress: string;
}) {
  const [shown, setShown] = useState<{ name: string; phone: string; detailAddress: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mapUrl = `https://map.kakao.com/link/search/${encodeURIComponent(roadAddress)}`;
  return (
    <div className="tec-section tec-contact">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {shown ? (
        <dl className="tec-kv ac-body">
          <dt>이름</dt>
          <dd>{shown.name}</dd>
          <dt>연락처</dt>
          <dd className="ac-num">{shown.phone}</dd>
          <dt>상세주소</dt>
          <dd>{shown.detailAddress || '없음'}</dd>
        </dl>
      ) : (
        <p className="ac-body">
          연락처 <span className="ac-masked ac-num">{phoneMasked}</span>
        </p>
      )}
      <div className="tec-btn-row">
        <a href={mapUrl} target="_blank" rel="noreferrer" className="ac-btn ac-btn--outline">
          <Navigation aria-hidden /> 길찾기
        </a>
        {shown ? (
          <a href={`tel:${shown.phone}`} className="ac-btn ac-btn--outline">
            <Phone aria-hidden /> 전화
          </a>
        ) : (
          <Button
            variant="outline"
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await revealJobContact(orderNo);
                if (!r.ok) return setError(r.message ?? '불러오지 못했습니다.');
                setShown(r.data as { name: string; phone: string; detailAddress: string });
              })
            }
          >
            연락처·상세주소 보기
          </Button>
        )}
      </div>
    </div>
  );
}

export function TransferRequest({ orderNo }: { orderNo: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="secondary" size="lg" block onClick={() => setOpen(true)}>
        다른 기사에게 이관 요청
      </Button>
      <Modal
        open={open}
        title="이관 요청"
        description="운영자가 승인하면 다른 기사에게 넘어갑니다. 승인 전까지는 예정대로 방문해 주세요."
        onClose={() => setOpen(false)}
        form
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              닫기
            </Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await requestJobTransfer({ orderNo, reason });
                  if (!r.ok) return setError(r.fieldErrors?.reason ?? r.message ?? '요청하지 못했습니다.');
                  setOpen(false);
                  toast('이관을 요청했습니다.');
                  router.refresh();
                })
              }
            >
              요청하기
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="이관 사유" required>
          {(id, d, inv) => (
            <Textarea
              id={id}
              aria-describedby={d}
              aria-invalid={inv}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              rows={3}
            />
          )}
        </Field>
      </Modal>
    </>
  );
}
