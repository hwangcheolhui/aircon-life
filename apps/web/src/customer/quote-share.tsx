'use client';
// C-QUO-040 견적 공유 (단계 9, F-CUS-QUO-07): 가족과 상의할 수 있게 견적 링크를 공유(휴대폰 공유창) 또는 복사. 견적은 유효기한(QUOTE_EXPIRE_DAYS)까지 보관
import { Button, useToast } from '@aircon/ui';
import { Share2 } from 'lucide-react';

export function QuoteShare({ quoteNo, expiresLabel }: { quoteNo: string; expiresLabel: string }) {
  const toast = useToast();
  const share = async () => {
    const url = `${window.location.origin}/quote/result/${quoteNo}`;
    const text = `에어컨 청소 견적 (${expiresLabel}까지 유효)`;
    try {
      if (navigator.share) {
        await navigator.share({ title: '에어컨 청소 견적', text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('견적 링크를 복사했어요.');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('공유하지 못했어요. 주소창의 링크를 복사해 주세요.');
    }
  };
  return (
    <Button variant="outline" block onClick={share}>
      <Share2 aria-hidden /> 견적 공유하기
    </Button>
  );
}
