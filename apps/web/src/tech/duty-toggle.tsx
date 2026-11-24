'use client';
// T-HOM-010 근무 시작/종료 토글 · F-TEC-AUTH-02: 처음 근무를 시작할 때 위치정보 수집 동의(1회)를 받는다.
// 근무 중에만 위치를 수집하고, 고객에게는 좌표 대신 도착 예정 시각만 보인다(BR-115).
import { Alert, Button, Modal, useToast } from '@aircon/ui';
import { MapPin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { agreeAndStartDuty, setDuty } from '@/app/(tech)/tech/(app)/actions';
import { formatClock } from '@/customer/format';

type Res = { ok: boolean; message?: string };

export function DutyToggle(p: {
  onDuty: boolean;
  since: string | null;
  locationAgreed: boolean;
  intervalSec: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<Res>, msg: string) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setError(r.message ?? '처리하지 못했습니다.');
    setError(null);
    setConsent(false);
    toast(msg);
    router.refresh();
  };
  return (
    <section className={`ac-card tec-duty${p.onDuty ? ' is-on' : ''}`} aria-labelledby="duty-title">
      <div className="tec-head-row">
        <div>
          <h2 id="duty-title" className="ac-h3">
            {p.onDuty ? '근무 중' : '근무 전'}
          </h2>
          <p className="ac-caption">
            {p.onDuty && p.since ? (
              <>
                <span className="ac-num">{formatClock(new Date(p.since))}</span> 시작 · 위치를{' '}
                <span className="ac-num">{Math.round(p.intervalSec / 60) || 1}</span>분마다 보냅니다
              </>
            ) : (
              '근무를 시작하면 출동 지도에 내 위치가 보이고, 근무 중에만 위치를 수집합니다.'
            )}
          </p>
        </div>
        <Button
          variant={p.onDuty ? 'outline' : 'primary'}
          loading={busy}
          aria-pressed={p.onDuty}
          onClick={() => {
            if (p.onDuty) return run(() => setDuty(false), '근무를 종료했습니다.');
            if (!p.locationAgreed) return setConsent(true);
            return run(() => setDuty(true), '근무를 시작했습니다.');
          }}
        >
          {p.onDuty ? '근무 종료' : '근무 시작'}
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Modal
        open={consent}
        title="위치정보 수집 동의"
        onClose={() => setConsent(false)}
        actions={
          <>
            <Button variant="outline" onClick={() => setConsent(false)}>
              취소
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => run(agreeAndStartDuty, '근무를 시작했습니다.')}
            >
              동의하고 근무 시작
            </Button>
          </>
        }
      >
        <div className="tec-consent">
          <MapPin aria-hidden />
          <ul>
            <li>근무 시작부터 근무 종료까지만 휴대폰 위치를 수집합니다.</li>
            <li>수집한 위치는 출동 지도·코스 안내와 일별 이동거리 집계에만 씁니다.</li>
            <li>고객에게는 위치 대신 도착 예정 시각만 안내합니다.</li>
            <li>원본 위치는 보관기간이 지나면 삭제합니다.</li>
          </ul>
        </div>
      </Modal>
    </section>
  );
}
