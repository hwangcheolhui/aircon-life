'use client';
/**
 * 주소 검색 모달 (F-CUS-QUO-01 고객 견적·예약, F-ADM-ORD-06 관리자 수동 접수). 채널 CSS 접두어(cus-/adm-)를 prefix 로 받는다. NEXT_PUBLIC_ADDRESS_DRIVER=kakao(기본) → 카카오 우편번호 서비스 위젯,
 * mock → 예시 주소 목록 검색 (packages/integrations/address).
 */
import {
  type AddressResult,
  KAKAO_POSTCODE_SCRIPT,
  type KakaoPostcodeData,
  createMockAddressSearch,
  fromKakaoPostcode,
  resolveAddressDriver,
} from '@aircon/integrations/address';
import { Button, Empty, Field, Input, Modal } from '@aircon/ui';
import { useEffect, useRef, useState } from 'react';

const driver = resolveAddressDriver(process.env.NEXT_PUBLIC_ADDRESS_DRIVER);

type PostcodeCtor = new (o: {
  oncomplete: (d: KakaoPostcodeData) => void;
  width: string;
  height: string;
}) => { embed: (el: HTMLElement) => void };
declare global {
  interface Window {
    daum?: { Postcode: PostcodeCtor };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadPostcodeScript(): Promise<void> {
  if (window.daum?.Postcode) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = KAKAO_POSTCODE_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('주소 검색을 불러오지 못했습니다.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function KakaoPostcode({ onSelect, prefix }: { onSelect: (a: AddressResult) => void; prefix: Prefix }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadPostcodeScript()
      .then(() => {
        if (!alive || !ref.current || !window.daum) return;
        new window.daum.Postcode({
          oncomplete: (d) => onSelect(fromKakaoPostcode(d)),
          width: '100%',
          height: '100%',
        }).embed(ref.current);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [onSelect]);
  if (error) return <p className="ac-body-sm">{error} 잠시 후 다시 시도해 주세요.</p>;
  return <div ref={ref} className={`${prefix}-postcode`} />;
}

const mockSearch = createMockAddressSearch();

function MockSearch({ onSelect, prefix }: { onSelect: (a: AddressResult) => void; prefix: Prefix }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AddressResult[] | null>(null);
  return (
    <form
      role="search"
      onSubmit={async (e) => {
        e.preventDefault();
        setResults(await mockSearch.search(q));
      }}
      style={{ textAlign: 'left' }}
    >
      <Field label="도로명·건물명·동 이름" help="개발용 예시 주소에서 검색합니다.">
        {(id, describedBy) => (
          <div className="ac-row" style={{ flexWrap: 'nowrap' }}>
            <Input
              id={id}
              aria-describedby={describedBy}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="예: 불광동"
            />
            <Button type="submit" variant="dark">
              검색
            </Button>
          </div>
        )}
      </Field>
      {results === null ? null : results.length === 0 ? (
        <Empty />
      ) : (
        <ul className={`${prefix}-address-results`}>
          {results.map((a) => (
            <li key={`${a.legalDongCode}-${a.roadAddress}`}>
              <button type="button" onClick={() => onSelect(a)}>
                <span className="ac-body">{a.roadAddress}</span>
                <br />
                <span className="ac-caption">
                  [지번] {a.jibunAddress} · <span className="ac-num">{a.zipcode}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

type Prefix = 'cus' | 'adm';

export function AddressSearchModal({
  open,
  onClose,
  onSelect,
  prefix = 'cus',
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (a: AddressResult) => void;
  prefix?: Prefix;
}) {
  return (
    <Modal
      open={open}
      title="주소 검색"
      onClose={onClose}
      actions={
        <Button variant="outline" block onClick={onClose}>
          닫기
        </Button>
      }
    >
      {open ? (
        driver === 'kakao' ? (
          <KakaoPostcode onSelect={onSelect} prefix={prefix} />
        ) : (
          <MockSearch onSelect={onSelect} prefix={prefix} />
        )
      ) : null}
    </Modal>
  );
}
