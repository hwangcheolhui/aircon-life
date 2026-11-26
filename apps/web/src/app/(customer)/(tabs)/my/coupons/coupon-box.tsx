'use client';
// C-MY-020 쿠폰함 탭(보유·사용·만료) + 코드 등록 (F-CUS-CPN-01)
import { Alert, Button, Card, Empty, Field, Input, Tabs, Tag } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDateLabel, formatWon } from '@/customer/format';
import { registerCoupon } from '../actions';

type Coupon = {
  id: number;
  name: string;
  discountType: string;
  discountValue: number;
  maxDiscount: number | null;
  minOrderAmount: number;
  validFrom: string | null;
  validTo: string;
  state: 'ISSUED' | 'USED' | 'EXPIRED';
  usedOrderNo: string | null;
};

const discountText = (c: Coupon) =>
  c.discountType === 'RATE' ? `${c.discountValue}% 할인${c.maxDiscount ? ` (최대 ${formatWon(c.maxDiscount)})` : ''}` : `${formatWon(c.discountValue)} 할인`;

export function CouponBox({ coupons, canRegister }: { coupons: Coupon[]; canRegister: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<'ISSUED' | 'USED' | 'EXPIRED'>('ISSUED');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = coupons.filter((c) => c.state === tab);
  const submit = async () => {
    setBusy(true);
    const r = await registerCoupon({ code });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: 'danger', text: r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '등록하지 못했어요.' });
    setMsg({ tone: 'success', text: `"${r.data!.name}" 쿠폰을 받았어요.` });
    setCode('');
    setTab('ISSUED');
    router.refresh();
  };
  return (
    <>
      {canRegister ? (
        <Card>
          {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
          <Field label="쿠폰 코드">
            {(id) => (
              <div className="ac-row">
                <Input id={id} value={code} maxLength={30} autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code && submit()} />
                <Button variant="dark" loading={busy} disabled={!code.trim()} onClick={submit}>
                  등록
                </Button>
              </div>
            )}
          </Field>
        </Card>
      ) : null}
      <Tabs
        items={[
          { value: 'ISSUED', label: `보유 ${coupons.filter((c) => c.state === 'ISSUED').length}` },
          { value: 'USED', label: '사용' },
          { value: 'EXPIRED', label: '만료' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {list.length === 0 ? (
        <Empty />
      ) : (
        <ul className="ac-stack cus-plain-list">
          {list.map((c) => (
            <li key={c.id}>
              <Card className={`cus-coupon${c.state === 'ISSUED' ? '' : ' is-dim'}`}>
                <strong className="ac-body">{c.name}</strong>
                <span className="ac-h3 ac-num">{discountText(c)}</span>
                <span className="ac-caption">
                  {c.minOrderAmount ? `${formatWon(c.minOrderAmount)} 이상 · ` : ''}
                  <span className="ac-num">{formatDateLabel(c.validTo)}</span>까지
                </span>
                {c.state === 'USED' ? <Tag>사용 {c.usedOrderNo ? <span className="ac-num">{c.usedOrderNo}</span> : null}</Tag> : c.state === 'EXPIRED' ? <Tag>만료</Tag> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
