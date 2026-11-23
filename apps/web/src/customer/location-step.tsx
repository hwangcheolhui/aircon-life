'use client';
// C-QUO-010 위치 입력 · F-CUS-QUO-01 (BR-001 서비스 지역 확인)
import type { AddressResult } from '@aircon/integrations/address';
import { Alert, Button, Card, Modal } from '@aircon/ui';
import { MapPin, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { checkServiceArea } from '@/app/(customer)/quote/actions';
import { AddressSearchModal } from './address-search';
import { QuoteBottomBar, StepHeader, useQuoteDraft } from './quote-flow';

export function LocationStep() {
  const router = useRouter();
  const { draft, update } = useQuoteDraft();
  const [searching, setSearching] = useState(false);
  const [checking, setChecking] = useState(false);
  const [outOfArea, setOutOfArea] = useState<AddressResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSelect = useCallback(
    async (a: AddressResult) => {
      setSearching(false);
      setChecking(true);
      setError(null);
      const r = await checkServiceArea(a.legalDongCode);
      setChecking(false);
      if (!r.ok) {
        setError(r.message ?? '서비스 지역을 확인하지 못했습니다. 다시 시도해 주세요.');
        return;
      }
      if (r.data?.serviceable) {
        // 주소가 바뀌면 이후 단계 입력을 새로 받는다
        update({ address: a, deviceTypes: [], lines: {}, options: {} });
      } else {
        update({ address: null });
        setOutOfArea(a);
      }
    },
    [update],
  );

  return (
    <>
      <main className="cus-flow__body">
        <StepHeader step={1} backHref="/" title="어디로 방문할까요?" />
        <p className="ac-body ac-caption">주소를 검색하면 서비스 가능한 지역인지 바로 알려 드려요.</p>
        <Button variant="outline" size="lg" block onClick={() => setSearching(true)} loading={checking}>
          <Search aria-hidden />
          {draft.address ? '다른 주소 검색' : '주소 검색'}
        </Button>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {draft.address ? (
          <Card>
            <div className="ac-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <MapPin aria-hidden />
              <div>
                <p className="ac-body" style={{ margin: 0, fontWeight: 600 }}>
                  {draft.address.roadAddress}
                </p>
                <p className="ac-caption" style={{ margin: 0 }}>
                  {draft.address.jibunAddress}
                </p>
              </div>
            </div>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Alert tone="success">서비스 가능한 지역입니다.</Alert>
            </div>
          </Card>
        ) : null}
      </main>
      <QuoteBottomBar label="예상 금액" amount={null}>
        <Button
          variant="primary"
          size="lg"
          disabled={!draft.address}
          onClick={() =>
            router.push(`/quote/device?dong=${encodeURIComponent(draft.address?.legalDongCode ?? '')}`)
          }
        >
          다음
        </Button>
      </QuoteBottomBar>
      <AddressSearchModal open={searching} onClose={() => setSearching(false)} onSelect={onSelect} />
      <Modal
        open={outOfArea !== null}
        title="아직 서비스하지 않는 지역이에요"
        description={
          <>
            {outOfArea?.roadAddress}
            <br />
            서비스 지역을 차례로 넓혀 가고 있어요. 다른 주소로 다시 확인해 주세요.
          </>
        }
        onClose={() => setOutOfArea(null)}
        actions={
          <Button
            variant="primary"
            block
            onClick={() => {
              setOutOfArea(null);
              setSearching(true);
            }}
          >
            다른 주소 검색
          </Button>
        }
      />
    </>
  );
}
