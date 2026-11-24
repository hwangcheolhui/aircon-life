/**
 * 관리자 단계 0 입력 스키마. 필수 누락 문구는 "○○은(는) 필수 입력값입니다." 형식(03 §6.2).
 * 폼은 문자열로 들어오므로 빈 문자열은 null로 바꾼 뒤 검증한다.
 */
import { MSG, PERMISSION_ACTIONS, isMobilePhone, validateDiscountTiers } from '@aircon/domain';
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
  z.preprocess(
    (v) => (blankToNull(v ?? null) === null ? null : Number(v)),
    z.number().int().min(min).nullable(),
  );
export const optId = () => optInt(1);
export const reqId = (label: string) => reqInt(label, 1);
const bool = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === null ? def : v === true || v === 'true' || v === 'on' || v === 'Y'),
    z.boolean(),
  );
const dateStr = (label: string) =>
  z.preprocess(
    (v) => (blankToNull(v) === null ? undefined : v),
    z
      .string({ required_error: MSG.required(label) })
      .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} 형식이 올바르지 않습니다.`),
  );
const optDate = () =>
  z.preprocess(
    (v) => blankToNull(v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  );
const optTime = () =>
  z.preprocess(
    (v) => blankToNull(v),
    z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, '시각 형식(HH:MM)이 올바르지 않습니다.')
      .nullable()
      .default(null),
  );
const optDecimal = (label: string) =>
  z.preprocess(
    (v) => blankToNull(v),
    z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, `${label}은(는) 숫자여야 합니다.`)
      .nullable()
      .default(null),
  );
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
  z.preprocess(
    (v) => {
      const b = blankToNull(v ?? null);
      if (b === null || typeof b !== 'string') return b;
      try {
        return JSON.parse(b);
      } catch {
        return Symbol.for('invalid-json');
      }
    },
    z.union([schema, z.null()], { errorMap: () => ({ message: `${label} JSON 형식이 올바르지 않습니다.` }) }),
  );

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
    z
      .string()
      .regex(/^\d{10}$/, '법정동 코드는 숫자 10자리입니다.')
      .nullable()
      .default(null),
  ),
  isServiceable: bool(true),
  travelFee: reqInt('원거리 출장비'),
});

/* ---------- A-SYS-010 관리자 계정 ---------- */
const adminBase = {
  name: reqStr('이름', 30),
  email: z.preprocess(
    (v) => trimmed(v),
    z.string().min(1, MSG.required('이메일')).email('이메일 형식이 올바르지 않습니다.').max(100),
  ),
  phone: optStr(20),
  roleId: reqId('역할'),
  branchId: optId(),
};
export const adminUserCreateInput = z.object({
  loginId: z.preprocess(
    (v) => trimmed(v),
    z
      .string()
      .min(1, MSG.required('ID'))
      .max(50)
      .regex(/^[a-zA-Z0-9._-]+$/, 'ID는 영문·숫자·._- 만 쓸 수 있습니다.'),
  ),
  initialPassword: reqStr('초기 비밀번호', 200),
  ...adminBase,
});
export const adminUserUpdateInput = z.object({
  id: reqId('ID'),
  ...adminBase,
  status: reqStr('계정 상태', 20),
});

/* ---------- A-SYS-020 역할·권한 ---------- */
export const rolePermissionUpdateInput = z.object({
  roleId: reqId('역할'),
  permissions: z.array(z.object({ menuCode: z.string().min(1).max(50), action: z.enum(PERMISSION_ACTIONS) })),
});
export const roleInput = z.object({
  roleCode: code('역할 코드'),
  name: reqStr('역할명', 50),
  dataScope: z.enum(['ALL', 'BRANCH', 'SELF'], {
    errorMap: () => ({ message: MSG.required('데이터 범위') }),
  }),
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
  .refine((v) => v.amountType !== 'RATE' || v.amount <= 100, {
    path: ['amount'],
    message: '정률은 100% 이하로 입력하세요.',
  });

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

/* ---------- 단계 1 견적 (F-CUS-QUO-01~04 · F-ADM-PRD-05) ---------- */
export const legalDongCodeInput = z.preprocess(
  (v) => (v == null ? '' : trimmed(v)),
  z
    .string()
    .min(1, MSG.required('주소'))
    .regex(/^\d{10}$/, '법정동 코드는 숫자 10자리입니다.'),
);
const qty = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label}은(는) 숫자여야 합니다.` })
    .int()
    .min(1, `${label}은(는) 1 이상이어야 합니다.`)
    .max(99, `${label}은(는) 99 이하로 입력하세요.`);
export const quoteLineInput = z.object({
  deviceType: code('기기 형태', 20),
  cleanLevel: code('작업 범위', 20),
  quantity: qty('대수'),
});
export const quoteOptionInput = z.object({
  optionId: z.coerce.number().int().min(1),
  quantity: qty('옵션 수량'),
});
/** 고객 견적 요청 (C-QUO-030 → C-QUO-040). 비회원·개인 고객 기준, 방문 일시는 예약 단계(단계 2)에서 받는다 */
export const customerQuoteInput = z.object({
  legalDongCode: legalDongCodeInput,
  lines: z.array(quoteLineInput).min(1, MSG.required('기기')).max(20),
  options: z.array(quoteOptionInput).max(20).default([]),
});
/** 관리자 견적 시뮬레이터 (A-PRD-050): 고객 견적과 같은 입력 + 고객유형·희망 방문 일시 */
export const quoteSimulationInput = customerQuoteInput
  .extend({
    customerType: z.enum(['PERSONAL', 'BUSINESS'], {
      errorMap: () => ({ message: MSG.required('고객 유형') }),
    }),
    visitDate: optDate(),
    visitTime: optTime(),
  })
  .refine((v) => (v.visitDate === null) === (v.visitTime === null), {
    path: ['visitTime'],
    message: '희망 방문 일시는 날짜와 시각을 함께 입력하세요.',
  });
export type CustomerQuoteInput = z.output<typeof customerQuoteInput>;
export type QuoteSimulationInput = z.output<typeof quoteSimulationInput>;

/* ---------- 단계 2 고객 가입·예약 (F-CUS-AUTH-01~05, F-CUS-RSV-01~05, F-CUS-ORD-03) ---------- */
/** 휴대폰 번호: 숫자만 남겨 010으로 시작하는 10~11자리 */
export const phoneInput = (label = '휴대폰 번호') =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/[^0-9]/g, '') : ''),
    z
      .string()
      .min(1, MSG.required(label))
      .regex(/^01[016789]\d{7,8}$/, `${label} 형식이 올바르지 않습니다.`),
  );
export const phoneStartInput = z.object({ name: reqStr('이름', 30), phone: phoneInput() });
export const phoneConfirmInput = z.object({
  phone: phoneInput(),
  code: z.preprocess(
    (v) => trimmed(v ?? ''),
    z
      .string()
      .min(1, MSG.required('인증번호'))
      .regex(/^\d{6}$/, '인증번호 6자리를 입력하세요.'),
  ),
});
export const signupConsentInput = z.object({
  TERMS: bool(false),
  PRIVACY_REQUIRED: bool(false),
  LOCATION: bool(false),
  MARKETING_SMS: bool(false),
  MARKETING_PUSH: bool(false),
});
export const consentSettingInput = signupConsentInput.omit({ TERMS: true, PRIVACY_REQUIRED: true });

const slotHour = z.coerce
  .number({ invalid_type_error: MSG.required('방문 시간') })
  .int()
  .min(0)
  .max(23);
export const reservationAddressInput = z.object({
  zipcode: reqStr('우편번호', 10),
  roadAddress: reqStr('도로명 주소', 200),
  jibunAddress: optStr(200),
  legalDongCode: legalDongCodeInput,
});
/** C-RSV-010~030 예약 (견적 번호 + 일정 + 방문 정보 + 결제 방식) */
export const reservationInput = z.object({
  quoteNo: reqStr('견적', 20),
  /** 체험 모드(DB 미연결)에서 견적 대신 넘기는 입력값 */
  demoQuote: z.unknown().optional(),
  slotDate: dateStr('방문 날짜'),
  slotHour,
  address: reservationAddressInput,
  detailAddress: reqStr('상세주소', 200),
  housingType: reqStr('주거 유형', 20),
  hasElevator: bool(false),
  parkingNote: optStr(200),
  customerRequest: optStr(500),
  payMethod: z.enum(['PREPAY', 'ONSITE'], { errorMap: () => ({ message: MSG.required('결제 방식') }) }),
  cancelPolicyAgreed: z.literal(true, { errorMap: () => ({ message: '취소 규정에 동의해 주세요.' }) }),
  duplicateConfirmed: bool(false),
});
export type ReservationInput = z.output<typeof reservationInput>;

/** C-ORD-030 일정 변경·취소 요청 */
export const changeRequestInput = z
  .object({
    orderNo: reqStr('접수번호', 20),
    requestType: z.enum(['RESCHEDULE', 'CANCEL'], {
      errorMap: () => ({ message: MSG.required('요청 유형') }),
    }),
    requestedDate: optDate(),
    requestedHour: z.preprocess(
      (v) => (blankToNull(v ?? null) === null ? null : Number(v)),
      z.number().int().min(0).max(23).nullable(),
    ),
    reason: optStr(500),
  })
  .refine((v) => v.requestType === 'CANCEL' || (v.requestedDate !== null && v.requestedHour !== null), {
    path: ['requestedDate'],
    message: MSG.required('새 일정'),
  });

export const withdrawInput = z.object({
  reason: optStr(300),
  agreed: z.literal(true, { errorMap: () => ({ message: '유의사항을 확인해 주세요.' }) }),
});

/* ---------- 단계 2 관리자 (A-TEC-010, A-DSP-030·040, A-ORD-010~040, A-CRM-040) ---------- */
export const technicianInput = z.object({
  techCode: code('기사 코드', 20),
  name: reqStr('이름', 30),
  displayName: optStr(30),
  phone: phoneInput('연락처'),
  branchId: reqId('소속 거점'),
  grade: reqStr('등급', 20),
  contractType: reqStr('계약 형태', 20),
  status: reqStr('상태', 20),
  joinedAt: optDate(),
});

export const scheduleBulkInput = z
  .object({
    technicianIds: z.array(z.coerce.number().int().min(1)).min(1, MSG.required('기사')),
    dateFrom: dateStr('시작일'),
    dateTo: dateStr('종료일'),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, MSG.required('요일')),
    scheduleType: reqStr('근무 유형', 20),
    startTime: optTime(),
    endTime: optTime(),
    maxJobs: optInt(0),
    note: optStr(200),
  })
  .refine((v) => v.dateFrom <= v.dateTo, { path: ['dateTo'], message: '종료일은 시작일 이후여야 합니다.' })
  .refine(
    (v) =>
      (v.startTime === null) === (v.endTime === null) &&
      (!v.startTime || !v.endTime || v.startTime < v.endTime),
    {
      path: ['endTime'],
      message: '근무 시간은 시작·종료를 함께, 종료가 시작보다 늦게 입력하세요.',
    },
  );

export const slotUpdateInput = z.object({
  id: reqId('슬롯'),
  capacity: reqInt('수용 건수'),
  isClosed: bool(false),
});
export const slotGenerateInput = z
  .object({ branchId: reqId('거점'), dateFrom: dateStr('시작일'), dateTo: dateStr('종료일') })
  .refine((v) => v.dateFrom <= v.dateTo, { path: ['dateTo'], message: '종료일은 시작일 이후여야 합니다.' });

export const orderCancelInput = z.object({
  orderId: reqId('주문'),
  cancelReason: reqStr('취소 사유', 30),
  memo: optStr(500),
});
export const orderUpdateInput = z.object({
  orderId: reqId('주문'),
  slotDate: optDate(),
  slotHour: z.preprocess(
    (v) => (blankToNull(v ?? null) === null ? null : Number(v)),
    z.number().int().min(0).max(23).nullable(),
  ),
  customerRequest: optStr(500),
  internalNote: optStr(1000),
  detailAddress: optStr(200),
});
export const changeRequestHandleInput = z.object({
  requestId: reqId('요청'),
  decision: z.enum(['APPROVED', 'REJECTED']),
});
export const manualOrderInput = z.object({
  customerId: optId(),
  name: optStr(30),
  phone: z.preprocess((v) => (blankToNull(v ?? null) === null ? null : v), phoneInput('연락처').nullable()),
  address: reservationAddressInput,
  detailAddress: reqStr('상세주소', 200),
  housingType: reqStr('주거 유형', 20),
  hasElevator: bool(false),
  parkingNote: optStr(200),
  lines: z.array(quoteLineInput).min(1, MSG.required('기기')).max(20),
  options: z.array(quoteOptionInput).max(20).default([]),
  customerType: z.enum(['PERSONAL', 'BUSINESS']).default('PERSONAL'),
  slotDate: dateStr('방문 날짜'),
  slotHour,
  orderType: reqStr('접수 유형', 20),
  channel: reqStr('접수 채널', 20),
  customerRequest: optStr(500),
  internalNote: optStr(1000),
  duplicateConfirmed: bool(false),
});
export const notificationTemplateInput = z.object({
  channel: reqStr('채널', 20),
  title: reqStr('제목', 100),
  body: reqStr('본문', 2000),
  kakaoTemplateId: optStr(50),
  isActive: bool(true),
});

/* ---------- 단계 1 보강: 서비스 지역 오픈 알림 신청 (F-CUS-QUO-08, BR-003) ---------- */
export const areaOpenRequestInput = z.object({
  legalDongCode: legalDongCodeInput,
  sido: reqStr('시도', 30),
  sigungu: reqStr('시군구', 30),
  eupmyeondong: reqStr('읍면동', 30),
  phone: z.preprocess(
    (v) => (v == null ? '' : trimmed(v)),
    z
      .string()
      .min(1, MSG.required('휴대폰 번호'))
      .refine(isMobilePhone, '휴대폰 번호를 정확히 입력해 주세요. (예: 010-1234-5678)'),
  ),
  privacyAgreed: bool(false).refine((v) => v, MSG.required('개인정보 수집·이용 동의')),
});

/* ---------- 단계 3 상담 콘솔 (F-ADM-CSL-01~10·13~16, F-ADM-CUS-01~03, F-ADM-CNT-05) ---------- */
/** 보조 연락처: 비우면 null, 넣으면 0으로 시작하는 9~11자리(유선 포함) */
const optPhone = (label: string) =>
  z.preprocess(
    (v) => {
      const d = typeof v === 'string' ? v.replace(/[^0-9]/g, '') : '';
      return d === '' ? null : d;
    },
    z
      .string()
      .regex(/^0\d{8,10}$/, `${label} 형식이 올바르지 않습니다.`)
      .nullable(),
  );
/** A-CSL-012 4단계 주소(주소검색 → 주소선택 → 상세주소 → 주소정제) 결과 */
export const consoleAddressInput = z.object({
  address: reservationAddressInput,
  detailAddress: reqStr('상세주소', 200),
  housingType: optStr(20),
  hasElevator: bool(false),
  parkingNote: optStr(200),
});
/** A-CSL-012 신규 고객 등록 */
export const consoleCustomerInput = consoleAddressInput.extend({
  name: reqStr('고객명', 30),
  phone1: phoneInput('전화1'),
  phone2: optPhone('전화2'),
  customerType: z.enum(['PERSONAL', 'BUSINESS']).default('PERSONAL'),
});
/** A-CSL-014 고객정보 수정 (주소는 새로 넣을 때만) */
export const consoleCustomerUpdateInput = z.object({
  customerId: reqId('고객'),
  name: reqStr('고객명', 30),
  phone1: phoneInput('전화1'),
  phone2: optPhone('전화2'),
  happycallReject: bool(false),
  newAddress: consoleAddressInput.nullable().default(null),
});
/** A-CSL-013 개인정보 동의 응답·철회 */
export const consentAnswerInput = z.object({
  customerId: reqId('고객'),
  callLogId: optId(),
  action: z.enum(['AGREE', 'DISAGREE', 'NOT_ASKED', 'WITHDRAW'], {
    errorMap: () => ({ message: MSG.required('동의 여부') }),
  }),
});
/** A-CSL-020 출장접수 */
export const phoneOrderInput = z.object({
  customerId: reqId('고객'),
  callLogId: optId(),
  addressId: reqId('방문 주소'),
  lines: z.array(quoteLineInput).min(1, MSG.required('기기 형태')).max(20),
  options: z.array(quoteOptionInput).max(20).default([]),
  symptom: reqStr('접수 증상', 30),
  brand: optStr(30),
  modelName: optStr(50),
  orderType: z.enum(['NORMAL', 'URGENT'], { errorMap: () => ({ message: MSG.required('접수 유형') }) }),
  customerRequest: optStr(500),
  twoPerson: bool(false),
  frequent: bool(false),
  requestedDate: optDate(),
  requestedTime: optTime(),
  slotDate: dateStr('약속일시'),
  slotHour,
  technicianId: optId(),
  internalNote: optStr(1000),
  duplicateConfirmed: bool(false),
});
export type PhoneOrderInput = z.output<typeof phoneOrderInput>;
/** A-CSL-050 일반문의·클레임 기록 */
export const consultRecordInput = z.object({
  customerId: reqId('고객'),
  callLogId: optId(),
  consultType: z.enum(['INQUIRY', 'CLAIM'], { errorMap: () => ({ message: MSG.required('상담 유형') }) }),
  subType: reqStr('세부 유형', 30),
  relatedOrderId: optId(),
  content: reqStr('상담 내용', 4000),
  done: bool(false),
});
/** A-CUS-020 등급·태그·메모 (F-ADM-CUS-03) */
export const customerGradeInput = z.object({
  customerId: reqId('고객'),
  grade: reqStr('고객 등급', 20),
  tags: z
    .array(z.string().regex(/^[A-Z0-9_]+$/))
    .max(20)
    .default([]),
});
export const customerMemoInput = z.object({ customerId: reqId('고객'), memo: optStr(4000) });
/** A-CNT-050 상담 스크립트 */
export const consultScriptInput = z.object({
  scriptCode: code('스크립트 코드', 30),
  title: reqStr('제목', 100),
  content: reqStr('내용', 4000),
  triggerPoint: reqStr('사용 시점', 30),
  isActive: bool(true),
});

/* ---------- 단계 4-1 기사 앱 (F-TEC-AUTH-01, F-TEC-MY-01, F-TEC-JOB-05) ---------- */
export const techPasswordLoginInput = z.object({ phone: phoneInput(), password: reqStr('비밀번호', 200) });
export const techOtpStartInput = z.object({ phone: phoneInput() });
export const techOtpConfirmInput = phoneConfirmInput;
export const techPasswordSetInput = z
  .object({
    newPassword: reqStr('새 비밀번호', 200),
    newPasswordConfirm: reqStr('새 비밀번호 확인', 200),
  })
  .refine((v) => v.newPassword === v.newPasswordConfirm, {
    path: ['newPasswordConfirm'],
    message: '새 비밀번호가 일치하지 않습니다.',
  });
export const techProfileInput = z.object({ intro: optStr(300) });
export const transferRequestInput = z.object({
  orderNo: reqStr('접수번호', 20),
  reason: reqStr('이관 사유', 200),
});

/* ---------- 단계 4-1 관리자 기사 상세 (A-TEC-020, F-ADM-TEC-02·03) ---------- */
export const technicianProfileInput = z.object({
  name: reqStr('이름', 30),
  displayName: optStr(30),
  phone: phoneInput('연락처'),
  branchId: reqId('소속 거점'),
  contractType: reqStr('계약 형태', 20),
  status: reqStr('상태', 20),
  joinedAt: optDate(),
  leftAt: optDate(),
  leaveReason: optStr(30),
  bizRegNo: optStr(20),
  licenses: optStr(200),
  bankCode: optStr(10),
  /** 비워 두면 기존 계좌 유지 */
  bankAccount: optStr(30),
  accountHolder: optStr(30),
  hasVehicle: bool(false),
  vehicleNo: optStr(20),
  insuranceJoined: bool(false),
  intro: optStr(300),
  accompanyRequiredCount: reqInt('초기 동행 건수'),
});
const skillRow = z.object({
  deviceType: reqStr('기기 유형', 20),
  skillLevel: z.enum(['CAN_ASSIST', 'CAN_SOLO', 'CAN_TEACH']),
});
export const technicianSkillsInput = z.object({
  technicianId: reqId('기사'),
  skills: z.array(skillRow).max(30),
});
const areaRow = z.object({
  legalDongCode: z.string().regex(/^\d{10}$/, '법정동 코드 형식이 올바르지 않습니다.'),
  priority: z.coerce.number().int().min(1).max(2),
});
export const technicianAreasInput = z.object({
  technicianId: reqId('기사'),
  areas: z.array(areaRow).max(300),
});
export const gradeChangeInput = z.object({
  technicianId: reqId('기사'),
  toGrade: reqStr('변경 등급', 20),
  reason: reqStr('변경 사유', 200),
  effectiveDate: dateStr('적용일'),
});

/* ---------- 단계 4-1 배정 (A-DSP-010·020, F-ADM-DSP-01·03·04) ---------- */
export const assignInput = z.object({
  orderId: reqId('주문'),
  mainTechId: reqId('주기사'),
  supportTechId: optId(),
  accompanyTechId: optId(),
  /** 경고(WARN)를 확인하고 배정 */
  confirmWarnings: bool(false),
});
export const reassignInput = z.object({
  orderId: reqId('주문'),
  toTechId: reqId('새 기사'),
  reason: reqStr('변경 사유', 200),
  confirmWarnings: bool(false),
});
export const unassignInput = z.object({ orderId: reqId('주문'), reason: reqStr('배정 취소 사유', 200) });
export const transferDecisionInput = z.object({
  assignmentId: reqId('이관 요청'),
  decision: z.enum(['APPROVE', 'REJECT']),
  toTechId: optId(),
  reason: optStr(200),
  confirmWarnings: bool(false),
});

/* ---------- 단계 4-2 관할 구역·코스·자가 배정·위치 (A-DSP-060·020, T-RTE-010·020, T-HOM-010) ---------- */
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
/** F-ADM-DSP-08 관할 구역 저장 */
export const zoneInput = z
  .object({
    id: optId(),
    technicianId: reqId('기사'),
    zoneName: reqStr('구역명', 50),
    zoneType: z.enum(['PRIMARY', 'SECONDARY'], { errorMap: () => ({ message: MSG.required('구역 구분') }) }),
    defineMethod: z.enum(['DONG_SET', 'DRAWN'], { errorMap: () => ({ message: MSG.required('지정 방식') }) }),
    dongCodes: z
      .array(z.string().regex(/^\d{10}$/))
      .max(300)
      .default([]),
    points: z.array(position).max(200).default([]),
    color: z.enum(['1', '2', '3', '4', '5', '6']).default('1'),
    validFrom: optDate(),
    validTo: optDate(),
  })
  .refine((v) => !v.validFrom || !v.validTo || v.validFrom <= v.validTo, {
    message: '적용 종료일이 시작일보다 빠릅니다.',
    path: ['validTo'],
  });
export const zoneDeleteInput = z.object({ id: reqId('관할 구역') });

/** F-ADM-DSP-10 자가 배정 승인·거절 (거절은 사유 필수) */
export const selfAssignDecisionInput = z
  .object({
    assignmentId: reqId('자가 배정 요청'),
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: optStr(200),
  })
  .refine((v) => v.decision === 'APPROVE' || Boolean(v.reason), {
    message: MSG.required('거절 사유'),
    path: ['reason'],
  });

/** F-TEC-RTE-01 코스 편집 (순서대로) */
export const routeEditInput = z.object({
  date: dateStr('코스 일자'),
  stops: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        type: z.enum(['JOB', 'BREAK', 'MATERIAL']),
        locked: z.boolean().default(false),
        workMin: z.number().int().min(5).max(240).optional(),
      }),
    )
    .max(60),
});
export const routeDateInput = z.object({ date: dateStr('코스 일자') });

/** F-TEC-RTE-04 내 일정에 넣기 */
export const selfAssignRequestInput = z.object({ orderNo: reqStr('접수번호', 20) });

/** F-TEC-MAP-05 근무 중 위치 1건 */
export const locationInput = z.object({
  lat: z.number().min(33).max(39),
  lng: z.number().min(124).max(132),
  accuracyM: z.number().min(0).max(100000).nullable().default(null),
  speedKmh: z.number().min(0).max(400).nullable().default(null),
});

/* ---------- 단계 5-1 현장작업 (T-WRK-010~070) ---------- */

const orderNoField = () => reqStr('접수번호', 20);

/** F-TEC-WRK-01 출발 (코스 순서와 다르면 force=true 로 다시 보낸다) */
export const workDepartInput = z.object({ orderNo: orderNoField(), force: bool(false) });
/** F-TEC-WRK-02 도착 */
export const workOrderNoInput = z.object({ orderNo: orderNoField() });

/** F-TEC-WRK-02 안전 체크리스트 → 작업 시작 (BR-043) */
export const workSafetyInput = z.object({
  orderNo: orderNoField(),
  checked: z.array(z.enum(['HIGH_PLACE', 'ELECTRIC', 'PROTECTIVE', 'CHEMICAL'])).max(4),
  highPlaceWork: bool(false),
});

/** F-TEC-WRK-03 작업 사진 1장 (파일은 FormData 의 file) */
export const workPhotoInput = z.object({
  orderNo: orderNoField(),
  photoType: z.enum(['BEFORE', 'DURING', 'AFTER', 'ISSUE', 'SAFETY']),
  orderItemId: optId(),
  unitNo: optInt(1),
  takenAt: z.preprocess((v) => blankToNull(v), z.string().datetime().nullable().default(null)),
});
export const workPhotoDeleteInput = z.object({ orderNo: orderNoField(), photoId: reqId('사진') });

/** F-TEC-WRK-04·10 기기별 처리 결과 · 오염도 · 발견 이슈 */
export const workResultInput = z.object({
  orderNo: orderNoField(),
  dirtLevel: z.preprocess((v) => blankToNull(v), z.enum(['LOW', 'MID', 'HIGH']).nullable().default(null)),
  issueFound: optStr(500),
  repairGuided: bool(false),
  units: z
    .array(
      z.object({
        orderItemId: reqId('주문 항목'),
        unitNo: reqInt('기기 번호', 1),
        result: z.enum(['DONE', 'PARTIAL', 'SKIPPED'], { errorMap: () => ({ message: MSG.required('처리 결과') }) }),
        conditionNote: optStr(300),
        recommendNext: z.preprocess(
          (v) => (blankToNull(v ?? null) === null ? null : Number(v)),
          z.number().int().min(1).max(36).nullable(),
        ),
      }),
    )
    .max(100),
});

/** F-TEC-WRK-07 처리 저장(완료) — 서명 이미지는 FormData 의 signature(선택) */
export const workCompleteInput = z.object({
  orderNo: orderNoField(),
  workNote: reqStr('처리 내용', 2000),
  internalNote: optStr(2000),
});

/** F-TEC-WRK-09 활동내역 등록 */
export const activityInput = z.object({
  orderNo: orderNoField(),
  activityType: z.enum(['CALL', 'SMS', 'VISIT_TRY', 'NOTE'], { errorMap: () => ({ message: MSG.required('유형') }) }),
  content: reqStr('내용', 500),
});

/* ---------- 단계 5-2 추가요금·미처리 ---------- */

/** F-TEC-WRK-05 추가요금 등록 (FormData: 값 + evidence 사진 선택). 유형별 필수값은 packages/domain checkExtraChargeInput */
export const extraChargeInput = z.object({
  orderNo: orderNoField(),
  chargeType: z.enum(['RULE', 'MATERIAL', 'ETC', 'DEVICE_ADD'], { errorMap: () => ({ message: MSG.required('유형') }) }),
  surchargeRuleId: optId(),
  baseOrderItemId: optId(),
  quantity: optInt(0),
  title: optStr(100),
  amount: optInt(0),
  reason: reqStr('사유', 300),
});

/** F-TEC-WRK-05 추가요금 철회 */
export const extraChargeRefInput = z.object({ orderNo: orderNoField(), chargeId: reqId('추가요금') });

/** F-CUS-ORD-04 고객 앱 동의/거절 */
export const extraChargeRespondInput = z.object({
  orderNo: orderNoField(),
  chargeId: reqId('추가요금'),
  decision: z.enum(['AGREE', 'DECLINE'], { errorMap: () => ({ message: MSG.required('동의 여부') }) }),
});

/** F-ADM-PRC-04 기타 추가요금 승인/반려 (반려 사유 필수) */
export const extraChargeDecisionInput = z
  .object({
    chargeId: reqId('추가요금'),
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: optStr(300),
  })
  .refine((v) => v.decision === 'APPROVE' || Boolean(v.reason), { message: MSG.required('반려 사유'), path: ['reason'] });

/** F-TEC-WRK-08 미처리 저장 (BR-031 사유 필수) */
export const workPendingInput = z.object({
  orderNo: orderNoField(),
  pendingCode: z.enum(['CUSTOMER_ABSENT', 'POSTPONED_CUSTOMER', 'POSTPONED_TECH', 'MATERIAL_SHORT', 'UNSAFE_SITE', 'WEATHER', 'ETC'], {
    errorMap: () => ({ message: MSG.required('미처리 사유') }),
  }),
  memo: optStr(500),
  revisitDate: optDate(),
});

/* ---------- 단계 6 결제·증빙 (F-TEC-PAY-01~03, F-CUS-PAY-02·03, F-ADM-PAY-01~05) ---------- */

/** F-TEC-PAY-01·02 현장 결제(카드단말·계좌이체·현금) — 금액 일치 검사는 domain checkCollect */
export const fieldPaymentInput = z.object({
  orderNo: orderNoField(),
  method: z.enum(['ONSITE_CARD', 'BANK_TRANSFER', 'CASH'], { errorMap: () => ({ message: MSG.required('결제 수단') }) }),
  amount: reqInt('받은 금액', 1),
  approvalNo: optStr(30),
});

/** F-TEC-PAY-01 고객에게 결제 요청(앱 알림톡 / 결제 링크 문자) */
export const paymentRequestInput = z.object({ orderNo: orderNoField(), channel: z.enum(['APP', 'LINK']) });

/** 미수로 남기기 (사유 필수) */
export const receivableInput = z.object({ orderNo: orderNoField(), reason: reqStr('미수 사유', 300) });

/** F-CUS-PAY-03 · F-TEC-PAY-03 증빙 신청 — 번호 형식은 domain checkTaxDocInput */
export const taxDocRequestInput = z.object({
  orderNo: orderNoField(),
  paymentId: reqId('결제'),
  docType: z.enum(['CASH_RECEIPT_INCOME', 'CASH_RECEIPT_EXPENSE', 'TAX_INVOICE'], { errorMap: () => ({ message: MSG.required('증빙 종류') }) }),
  identityNo: reqStr('발급 번호', 30),
});

/** F-ADM-PAY-05 증빙 발행(세금계산서는 국세청 승인번호 직접 입력)·취소 */
export const taxDocActionInput = z.object({
  taxDocId: reqId('증빙'),
  action: z.enum(['ISSUE', 'CANCEL']),
  issuedNo: optStr(50),
});

/** F-ADM-PAY-03 환불 */
export const refundInput = z.object({
  paymentId: reqId('결제'),
  amount: reqInt('환불 금액', 1),
  fee: reqInt('수수료', 0),
  reasonCode: z.enum(['CUSTOMER_CANCEL', 'SERVICE_FAIL', 'COMPENSATION', 'DUPLICATE'], { errorMap: () => ({ message: MSG.required('환불 사유') }) }),
  reasonDetail: optStr(300),
});

/** F-ADM-PAY-04 미수금 독촉 메모([미수금]) */
export const receivableMemoInput = z.object({ orderId: reqId('주문'), content: reqStr('메모 내용', 1000) });

/** F-ADM-PAY-04 입금 확인(관리자 수금 기록) */
export const adminCollectInput = z.object({
  orderId: reqId('주문'),
  method: z.enum(['BANK_TRANSFER', 'CASH'], { errorMap: () => ({ message: MSG.required('결제 수단') }) }),
  amount: reqInt('입금 금액', 1),
});

/** F-ADM-PAY-02 결제 링크 다시 보내기 */
export const resendPaymentLinkInput = z.object({ orderId: reqId('주문') });

/* ---------- 단계 6-2 처리 콘솔·미처리 대기열 (F-ADM-PRC-01·02·05·06·07) ---------- */

const PENDING_CODES = ['CUSTOMER_ABSENT', 'POSTPONED_CUSTOMER', 'POSTPONED_TECH', 'MATERIAL_SHORT', 'UNSAFE_SITE', 'WEATHER', 'ETC'] as const;

/** F-ADM-PRC-02 대리 처리 저장. 방문 일시는 KST 'YYYY-MM-DDTHH:mm', 검증은 domain checkProxyCompletion */
export const proxyCompleteInput = z.object({
  orderId: reqId('주문'),
  visitedAt: z.preprocess(
    (v) => blankToNull(v),
    z
      .string({ required_error: MSG.required('방문 일시'), invalid_type_error: MSG.required('방문 일시') })
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, MSG.required('방문 일시')),
  ),
  workMinutes: reqInt('작업 시간', 1),
  safetyDone: bool(false),
  highPlaceWork: bool(false),
  materialAmount: reqInt('자재 금액', 0),
  discountAmount: reqInt('할인 금액', 0),
  workNote: reqStr('처리 내용', 2000),
  internalNote: optStr(2000),
  units: z
    .array(
      z.object({
        orderItemId: reqId('기기'),
        unitNo: reqInt('기기 번호', 1),
        result: z.enum(['DONE', 'PARTIAL', 'SKIPPED'], { errorMap: () => ({ message: MSG.required('처리 결과') }) }),
      }),
    )
    .min(1, MSG.required('처리 결과')),
});

/** F-ADM-PRC-02 대리 미처리 저장 (BR-031 사유 필수) */
export const proxyPendingInput = z.object({
  orderId: reqId('주문'),
  pendingCode: z.enum(PENDING_CODES, { errorMap: () => ({ message: MSG.required('미처리 사유') }) }),
  memo: optStr(500),
  revisitDate: optDate(),
});

/** F-ADM-PRC-02 대리 입력 작업 사진 (FormData: 값 + file) — BR-041 전·후 사진 */
export const proxyPhotoInput = z.object({
  orderId: reqId('주문'),
  orderItemId: reqId('기기'),
  unitNo: reqInt('기기 번호', 1),
  photoType: z.enum(['BEFORE', 'AFTER'], { errorMap: () => ({ message: MSG.required('사진 종류') }) }),
});

/** F-ADM-PRC-06 파일 첨부 (FormData: 값 + file) */
export const consoleFileInput = z.object({
  orderId: reqId('주문'),
  kind: z.enum(['SAFETY', 'DOC'], { errorMap: () => ({ message: MSG.required('파일 종류') }) }),
});

/** F-ADM-PRC-07 활동내역 등록 (관리자) */
export const adminActivityInput = z.object({
  orderId: reqId('주문'),
  activityType: z.enum(['CALL', 'SMS', 'VISIT_TRY', 'NOTE'], { errorMap: () => ({ message: MSG.required('유형') }) }),
  content: reqStr('내용', 500),
});

/** F-ADM-PRC-05 재약속 (PENDING → ASSIGNED). BR-031 운영자 확인은 domain checkReschedule */
export const rescheduleInput = z.object({
  orderId: reqId('주문'),
  slotDate: dateStr('재약속 날짜'),
  slotHour: reqInt('방문 시각', 0),
  operatorConfirmed: bool(false),
  confirmMemo: optStr(300),
});

/** F-ADM-PRC-05 미처리 취소 */
export const pendingCancelInput = z.object({
  orderId: reqId('주문'),
  reasonCode: z.enum(['CUSTOMER_REQUEST', 'NO_TECH', 'DUPLICATE', 'OUT_OF_AREA', 'NO_SHOW', 'PRICE'], {
    errorMap: () => ({ message: MSG.required('취소 사유') }),
  }),
  memo: optStr(300),
});
