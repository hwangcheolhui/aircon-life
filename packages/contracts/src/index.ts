/**
 * 관리자 단계 0 입력 스키마. 필수 누락 문구는 "○○은(는) 필수 입력값입니다." 형식(03 §6.2).
 * 폼은 문자열로 들어오므로 빈 문자열은 null로 바꾼 뒤 검증한다.
 */
import { MSG, PERMISSION_ACTIONS, validateDiscountTiers } from '@aircon/domain';
import { z } from 'zod';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

/** 필수 문자열 */
export const reqStr = (label: string, max: number) =>
  z.preprocess(
    (v) => (v == null ? '' : trimmed(v)),
    z.string().min(1, MSG.required(label)).max(max, `${label}은(는) ${max}자 이하로 입력하세요.`),
  );
/** 선택 문자열 */
export const optStr = (max: number) =>
  z.preprocess((v) => blankToNull(trimmed(v)), z.string().max(max).nullable().default(null));
/** 필수 정수(0 이상) */
export const reqInt = (label: string, min = 0) =>
  z.preprocess(
    (v) => (blankToNull(v) === null ? undefined : Number(v)),
    z
      .number({ required_error: MSG.required(label), invalid_type_error: `${label}은(는) 숫자여야 합니다.` })
      .int(`${label}은(는) 정수여야 합니다.`)
      .min(min, `${label}은(는) ${min} 이상이어야 합니다.`),
  );
export const optInt = (min = 0) =>
  z.preprocess((v) => (blankToNull(v ?? null) === null ? null : Number(v)), z.number().int().min(min).nullable());
export const optId = () => optInt(1);
export const reqId = (label: string) => reqInt(label, 1);
const bool = (def: boolean) =>
  z.preprocess((v) => (v === undefined || v === null ? def : v === true || v === 'true' || v === 'on' || v === 'Y'), z.boolean());
const dateStr = (label: string) =>
  z.preprocess(
    (v) => (blankToNull(v) === null ? undefined : v),
    z.string({ required_error: MSG.required(label) }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} 형식이 올바르지 않습니다.`),
  );
const optDate = () =>
  z.preprocess((v) => blankToNull(v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null));
const optTime = () =>
  z.preprocess((v) => blankToNull(v), z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, '시각 형식(HH:MM)이 올바르지 않습니다.').nullable().default(null));
const optDecimal = (label: string) =>
  z.preprocess((v) => blankToNull(v), z.string().regex(/^-?\d+(\.\d+)?$/, `${label}은(는) 숫자여야 합니다.`).nullable().default(null));
const code = (label: string, max = 30) =>
  z.preprocess(
    (v) => (v == null ? '' : trimmed(v)),
    z
      .string()
      .min(1, MSG.required(label))
      .max(max)
      .regex(/^[A-Z0-9_-]+$/, `${label}은(는) 영문 대문자·숫자·_·- 만 쓸 수 있습니다.`),
  );
const jsonField = <T extends z.ZodTypeAny>(label: string, schema: T) =>
  z.preprocess((v) => {
    const b = blankToNull(v ?? null);
    if (b === null || typeof b !== 'string') return b;
    try {
      return JSON.parse(b);
    } catch {
      return Symbol.for('invalid-json');
    }
  }, z.union([schema, z.null()], { errorMap: () => ({ message: `${label} JSON 형식이 올바르지 않습니다.` }) }));

/* ---------- A-AUTH ---------- */
export const loginInput = z.object({ loginId: reqStr('ID', 50), password: reqStr('비밀번호', 200) });
export const passwordChangeInput = z
  .object({
    currentPassword: reqStr('현재 비밀번호', 200),
    newPassword: reqStr('새 비밀번호', 200),
    newPasswordConfirm: reqStr('새 비밀번호 확인', 200),
  })
  .refine((v) => v.newPassword === v.newPasswordConfirm, {
    path: ['newPasswordConfirm'],
    message: '새 비밀번호가 일치하지 않습니다.',
  });

/* ---------- A-SYS-030 거점 ---------- */
export const branchInput = z.object({
  branchCode: code('거점 코드', 20),
  name: reqStr('거점명', 50),
  status: reqStr('운영 상태', 20),
  address: optStr(200),
  centerLat: optDecimal('중심 위도'),
  centerLng: optDecimal('중심 경도'),
  radiusKm: optDecimal('서비스 반경'),
  phone: optStr(20),
  managerAdminId: optId(),
  openTime: optTime(),
  closeTime: optTime(),
  openedAt: optDate(),
});

/* ---------- A-DSP-050 관할 지역 ---------- */
export const serviceAreaInput = z.object({
  branchId: reqId('담당 거점'),
  sido: reqStr('시도', 30),
  sigungu: reqStr('시군구', 30),
  eupmyeondong: reqStr('읍면동', 30),
  legalDongCode: z.preprocess(
    (v) => blankToNull(trimmed(v)),
    z.string().regex(/^\d{10}$/, '법정동 코드는 숫자 10자리입니다.').nullable().default(null),
  ),
  isServiceable: bool(true),
  travelFee: reqInt('원거리 출장비'),
});

/* ---------- A-SYS-010 관리자 계정 ---------- */
const adminBase = {
  name: reqStr('이름', 30),
  email: z.preprocess((v) => trimmed(v), z.string().min(1, MSG.required('이메일')).email('이메일 형식이 올바르지 않습니다.').max(100)),
  phone: optStr(20),
  roleId: reqId('역할'),
  branchId: optId(),
};
export const adminUserCreateInput = z.object({
  loginId: z.preprocess(
    (v) => trimmed(v),
    z.string().min(1, MSG.required('ID')).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'ID는 영문·숫자·._- 만 쓸 수 있습니다.'),
  ),
  initialPassword: reqStr('초기 비밀번호', 200),
  ...adminBase,
});
export const adminUserUpdateInput = z.object({ id: reqId('ID'), ...adminBase, status: reqStr('계정 상태', 20) });

/* ---------- A-SYS-020 역할·권한 ---------- */
export const rolePermissionUpdateInput = z.object({
  roleId: reqId('역할'),
  permissions: z.array(z.object({ menuCode: z.string().min(1).max(50), action: z.enum(PERMISSION_ACTIONS) })),
});
export const roleInput = z.object({
  roleCode: code('역할 코드'),
  name: reqStr('역할명', 50),
  dataScope: z.enum(['ALL', 'BRANCH', 'SELF'], { errorMap: () => ({ message: MSG.required('데이터 범위') }) }),
});

/* ---------- A-SYS-040 공통 코드 ---------- */
export const commonCodeInput = z.object({
  groupCode: code('코드 그룹', 50),
  code: code('코드', 50),
  name: reqStr('표시명', 100),
  sortOrder: reqInt('정렬 순서'),
  isActive: bool(true),
  extraJson: jsonField('부가 속성', z.record(z.unknown())),
});

/* ---------- A-SYS-050 공휴일·설정 ---------- */
export const holidayInput = z.object({
  holidayDate: dateStr('공휴일'),
  name: reqStr('명칭', 50),
  isSurcharge: bool(true),
});
export const systemSettingInput = z.object({
  settingKey: code('설정 키', 50),
  settingValue: reqStr('설정값', 500),
  description: optStr(200),
});

/* ---------- A-PRD-010 카테고리 ---------- */
export const serviceCategoryInput = z.object({
  code: code('카테고리 코드', 20),
  name: reqStr('표시명', 50),
  phase: optInt(1),
  isActive: bool(true),
  sortOrder: reqInt('정렬 순서'),
});

/* ---------- A-PRD-011 상품 ---------- */
export const serviceProductInput = z.object({
  categoryId: reqId('카테고리'),
  productCode: code('상품 코드'),
  name: reqStr('상품명', 100),
  deviceType: reqStr('기기 형태', 20),
  cleanLevel: reqStr('작업 범위', 20),
  baseDurationMin: reqInt('표준 소요 시간', 1),
  requiredTechCount: reqInt('필요 인원', 1),
  requiredSkillLevel: optStr(20),
  description: optStr(4000),
  includedItems: optStr(4000),
  excludedItems: optStr(4000),
  warrantyDays: reqInt('보증 기간'),
  isActive: bool(true),
});

/* ---------- A-PRD-020 가격 정책 ---------- */
export const discountTiersSchema = z
  .array(z.object({ min: z.number().int(), rate: z.number() }))
  .superRefine((tiers, ctx) => {
    const err = validateDiscountTiers(tiers);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
  });
export const pricePolicyInput = z
  .object({
    productId: reqId('상품'),
    branchId: optId(),
    customerType: optStr(20),
    unitPrice: reqInt('단가'),
    multiUnitDiscountJson: jsonField('대수 할인', discountTiersSchema),
    validFrom: dateStr('적용 시작일'),
    validTo: optDate(),
    priority: reqInt('우선순위'),
  })
  .refine((v) => v.validTo === null || v.validTo >= v.validFrom, {
    path: ['validTo'],
    message: '적용 종료일은 시작일 이후여야 합니다.',
  });
export const pricePreviewInput = z.object({
  productId: reqId('상품'),
  branchId: optId(),
  customerType: z.preprocess(blankToNull, z.enum(['PERSONAL', 'BUSINESS']).nullable().default(null)),
  date: dateStr('적용일'),
});

/* ---------- A-PRD-030 할증 ---------- */
export const surchargeRuleInput = z
  .object({
    ruleCode: code('규칙 코드'),
    name: reqStr('표시명', 50),
    applyType: reqStr('적용 시점', 20),
    conditionJson: jsonField('조건', z.record(z.unknown())),
    amountType: z.enum(['FIXED', 'RATE'], { errorMap: () => ({ message: MSG.required('금액 유형') }) }),
    amount: reqInt('금액'),
    perUnit: bool(false),
    customerNotice: optStr(300),
    isActive: bool(true),
  })
  .refine((v) => v.amountType !== 'RATE' || v.amount <= 100, { path: ['amount'], message: '정률은 100% 이하로 입력하세요.' });

/* ---------- A-PRD-040 옵션·자재 ---------- */
export const serviceOptionInput = z.object({
  productId: optId(),
  optionCode: code('옵션 코드'),
  name: reqStr('옵션명', 100),
  price: reqInt('가격'),
  durationMin: reqInt('추가 소요 시간'),
  isActive: bool(true),
});
export const materialInput = z.object({
  materialCode: code('자재 코드'),
  name: reqStr('자재명', 100),
  unit: reqStr('단위', 10),
  unitCost: reqInt('원가'),
  salePrice: reqInt('판매가'),
  safetyStock: reqInt('안전 재고'),
  isActive: bool(true),
});

/** 검증 오류를 { 필드: 문구 } 로 */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join('.') || '_';
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

export { z };
