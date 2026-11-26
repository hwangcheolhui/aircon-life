// A-VOC-040 후기 관리 · F-ADM-VOC-04: 평점·NPS·태그·사진 후기 조회, 답글·숨김(숨기면 기사 평균 평점에서 뺀다).
// BR-090 저평점(2점 이하) 후기는 VOC로 자동 등록되어 VOC 번호로 이어진다. 거점 범위(BR-102).
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { listReviews } from '@/server/reviews';
import { ReviewScreen } from './screen';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; maxRating?: string }> }) {
  const admin = await requireScreen('A-VOC-040');
  const sp = await searchParams;
  const maxRating = Number(sp.maxRating);
  const q = {
    from: sp.from && DATE.test(sp.from) ? sp.from : null,
    to: sp.to && DATE.test(sp.to) ? sp.to : null,
    maxRating: Number.isInteger(maxRating) && maxRating >= 1 && maxRating <= 5 ? maxRating : null,
    techId: null,
  };
  const [rows, codes] = await Promise.all([listReviews(await currentBranchFilter(admin), q), loadCodes(['REVIEW_TAG'])]);
  return (
    <ReviewScreen
      rows={rows}
      codes={codes}
      q={{ from: q.from ?? '', to: q.to ?? '', maxRating: q.maxRating ? String(q.maxRating) : '' }}
      canUpdate={!admin.preview && hasPermission(admin, 'A-VOC-040', 'UPDATE')}
    />
  );
}
