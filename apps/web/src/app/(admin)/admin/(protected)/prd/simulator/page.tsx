// A-PRD-050 견적 시뮬레이터 · F-ADM-PRD-05 (조건 입력 → 고객과 동일한 견적 결과)
import { branch, serviceArea, serviceOption, serviceProduct } from '@aircon/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { getDb } from '@/server/db';
import { DEMO_QUOTE_CATALOG, demoAreaPrefixes, isQuoteDemoMode } from '@/server/quote-demo';
import { SimulatorScreen } from './screen';

export default async function SimulatorPage() {
  const admin = await requireScreen('A-PRD-050');
  const filter = await currentBranchFilter(admin); // BR-102: 관할 지역 목록은 볼 수 있는 거점만
  const db = getDb();
  const [areas, products, options, codes] = await Promise.all([
    filter.kind === 'NONE'
      ? Promise.resolve([])
      : db
          .select({
            legalDongCode: serviceArea.legalDongCode,
            sido: serviceArea.sido,
            sigungu: serviceArea.sigungu,
            eupmyeondong: serviceArea.eupmyeondong,
            isServiceable: serviceArea.isServiceable,
            branchName: branch.name,
          })
          .from(serviceArea)
          .innerJoin(branch, eq(branch.id, serviceArea.branchId))
          .where(filter.kind === 'BRANCH' ? eq(serviceArea.branchId, filter.branchId) : undefined)
          .orderBy(asc(serviceArea.sido), asc(serviceArea.sigungu), asc(serviceArea.eupmyeondong)),
    db
      .select({ deviceType: serviceProduct.deviceType, cleanLevel: serviceProduct.cleanLevel })
      .from(serviceProduct)
      .where(and(eq(serviceProduct.isActive, true), isNull(serviceProduct.deletedAt))),
    db
      .select({ id: serviceOption.id, name: serviceOption.name, price: serviceOption.price })
      .from(serviceOption)
      .where(eq(serviceOption.isActive, true))
      .orderBy(asc(serviceOption.optionCode)),
    loadCodes(['DEVICE_TYPE', 'CLEAN_LEVEL', 'CUSTOMER_TYPE', 'QUOTE_ITEM_TYPE']),
  ]);
  // DB 미연결 체험 모드: 고객 화면과 같은 예시 상품·옵션으로 시뮬레이션한다(server/quote-demo.ts)
  const demo = isQuoteDemoMode();
  return (
    <SimulatorScreen
      demoNotice={
        demo
          ? `체험 모드: 예시 가격으로 계산합니다. 서비스 가능 지역은 법정동 코드 ${demoAreaPrefixes().join(', ')}(으)로 시작하는 주소입니다.`
          : null
      }
      areas={areas
        .filter((a) => a.legalDongCode)
        .map((a) => ({
          value: a.legalDongCode!,
          label: `${a.sido} ${a.sigungu} ${a.eupmyeondong} · ${a.branchName}${a.isServiceable ? '' : ' (서비스 불가)'}`,
        }))}
      products={demo ? [...DEMO_QUOTE_CATALOG.products] : products}
      options={demo ? [...DEMO_QUOTE_CATALOG.options] : options}
      codes={codes}
    />
  );
}
