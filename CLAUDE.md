# CLAUDE.md

에어컨 청소 기반 지역생활서비스 플랫폼(고객 웹 · 기사 웹앱 · 관리자 웹)입니다.
이 파일은 Claude Code가 이 저장소에서 작업할 때 **항상** 따라야 하는 규칙입니다.

---

## 1. 문서가 단일 출처다 (가장 중요)

코드를 쓰기 전에 관련 문서를 먼저 읽고, 문서와 다르게 구현하지 않습니다.

| 문서 | 무엇의 기준인가 |
|---|---|
| [docs/01_ERD.md](docs/01_ERD.md) | 테이블·컬럼·타입·제약(§2), 상태 머신(§3), 공통 코드(§4), KPI(§5), 개인정보 규칙(§6) |
| [docs/02_기능정의서.md](docs/02_기능정의서.md) | 기능 ID(`F-…`), 입력·처리·출력·예외, 배치(F-SYS), 업무 규칙(`BR-…`, §5), 외부 연동(§6), 비기능(§7) |
| [docs/03_IA.md](docs/03_IA.md) | 화면 ID(`C-/T-/A-…`), 내비게이션, 역할별 메뉴 권한(§4.4), 상태 배지(§6.1), 공통 UI 규칙(§6.2) |
| [docs/04_구현계획.md](docs/04_구현계획.md) | 구현 순서(단계 0~11), 단계별 화면·기능·테이블·완료 기준, 단계 종료 점검표(§4) |
| [docs/05_디자인시스템.md](docs/05_디자인시스템.md) | 색·타이포·간격·컴포넌트·접근성 규칙 |
| [docs/design-system/](docs/design-system/) | `tokens.css`(값의 단일 출처), `components.css`(`ac-` 컴포넌트), `tokens.json`(상태 코드 → 표시명·클래스 맵) |
| [docs/06_기술스택_제안.md](docs/06_기술스택_제안.md) | 기술 스택·프로젝트 구조·외부 연동 선택 (v0.2: Next.js 단일 앱 + Vercel + Supabase 확정) |
| [docs/07_테스트데이터.md](docs/07_테스트데이터.md) | 테스트용 가상 데이터 시드(`pnpm db:seed:demo`)·테스트 계정·로그인 방법 |

규칙
- 문서에 없는 테이블·컬럼·상태·코드값·화면을 임의로 만들지 않습니다. 필요하면 **먼저 해당 문서를 수정**하고 코드에 반영합니다.
- 구현 중 컬럼·규칙·화면이 바뀌면 **같은 작업 안에서** 01~05 문서를 함께 고칩니다(04 §4 "문서 동기화").
- 문서끼리 충돌하면 작업을 멈추고 사용자에게 어느 쪽이 맞는지 묻습니다. 추측으로 한쪽을 고르지 않습니다.

## 2. ID 기준으로 작업한다

- **화면 ID**(`C-QUO-010`, `T-WRK-020`, `A-CSL-010`): 페이지·라우트 파일 상단 주석에 화면 ID를 적습니다. 권한의 `permission.menu_code`도 화면 ID와 같게 합니다(03 §0.2-5).
- **기능 ID**(`F-CUS-QUO-04`): 서버 액션·라우트 핸들러·서비스 함수·배치 잡 주석에 기능 ID를 적습니다.
- **업무 규칙**(`BR-012`): 규칙을 구현한 코드와 그 테스트 이름에 BR 번호를 넣습니다. 예: `it('BR-013 야간·휴일 동시 해당 시 높은 할증 1건만 적용')`.
- 커밋 메시지·PR 설명에도 다룬 단계·화면 ID·기능 ID를 적습니다. 예: `feat(quote): 자동 표준 견적 산출 [단계1][C-QUO-040][F-CUS-QUO-04]`.

## 3. 기술 스택과 구조

[docs/06_기술스택_제안.md](docs/06_기술스택_제안.md) §2~§3을 따릅니다. 요약:

- TypeScript 모노레포(pnpm workspace + Turborepo)
- `apps/web`: **Next.js(App Router) 앱 하나**. 고객 `/` · 기사 `/tech` · 관리자 `/admin` (경로별 루트 레이아웃이 `data-channel` 지정)
- 서버 로직은 서버 액션·라우트 핸들러(별도 API 서버 없음). 배치는 Vercel Cron → `/api/jobs/*`
- **Vercel** 배포, **Supabase**: Auth(로그인) · PostgreSQL + PostGIS · Storage. Drizzle ORM(서버 전용 연결)
- **관리자 데이터 수정은 서버에서 권한 확인**: 모든 서버 액션 첫 줄에 `requirePermission(화면ID, 행위)`, 페이지는 `requireScreen(화면ID)`. 모든 테이블 RLS 활성화(`has_permission`·`can_access_branch`)
- `packages/db`(스키마·마이그레이션·시드), `packages/domain`(순수 비즈니스 로직), `packages/contracts`(Zod DTO), `packages/integrations`(외부 연동 어댑터), `packages/ui`(디자인 시스템), `packages/config`

스택을 바꾸거나 새 주요 라이브러리를 들이려면 먼저 사용자에게 확인하고 06 문서를 갱신합니다.

## 4. 작업 방식

1. **한 번에 04 구현계획의 한 단계(또는 하위 단계)만** 진행합니다. 단계 순서를 건너뛰지 않습니다. 단계 5는 5-1(출발~완료)과 5-2(추가요금·미처리)로 나눕니다.
2. 작업 범위를 지킵니다. 요청이 관리자 화면(`apps/web/src/app/(admin)`)이면 고객·기사 경로는 건드리지 않습니다(공용 패키지 변경이 필요하면 이유를 밝힙니다).
3. **업무 규칙은 테스트 먼저**: BR 규칙마다 정상·예외 케이스 테스트를 `packages/domain`에 먼저 쓰고 구현합니다.
4. 단계를 마칠 때 04 §4 점검표(흐름 시연·상태 이력·권한·BR·개인정보·알림·문서 동기화)를 확인하고 결과를 보고합니다.
5. 타입체크·린트·테스트가 통과하지 않은 상태로 완료라고 보고하지 않습니다.

## 5. 데이터·도메인 규칙 (01_ERD §0.3, §3, §6)

- PK는 `id` BIGINT 자동증가. 외부 노출 번호는 별도 컬럼(`order_no` 등).
- 모든 업무 테이블에 `created_at`, `created_by`, `updated_at`, `updated_by`. 이력이 중요한 테이블은 `deleted_at` 소프트 삭제.
- 결제·정산·상태 이력·동의 이력·감사 로그는 **INSERT ONLY**. UPDATE/DELETE 코드를 만들지 않습니다.
- 상태·유형 값은 `common_code`의 코드 문자열. 화면 표시명은 코드에서 하드코딩하지 않고 코드 테이블/`tokens.json`에서 가져옵니다.
- 금액은 원 단위 정수(부가세 포함). 할인·할증은 별도 행으로 저장해 합계를 재계산할 수 있게 합니다.
- **상태 변경은 반드시 `packages/domain`의 상태 전이 함수를 거치고**, 이력 테이블(`order_status_history` 등)에 1행 INSERT 합니다. ERD §3에 없는 전이는 허용하지 않습니다.
- 견적 계산은 공용 모듈 하나만 둡니다(고객 견적 · 상담 콘솔 · 관리자 시뮬레이터가 같은 결과여야 함, BR-010~015). 견적 시점 단가는 스냅샷 저장(BR-014).
- 운영 데이터는 `branch_id`를 가지며 거점장·거점 소속 관리자는 자기 거점만 조회합니다(BR-102). API 가드에서 일괄 적용합니다.
- 기준값(할증 금액, 이동 버퍼, 코스 확정 마감, 견적 유효일 등)은 코드에 박지 않고 `system_setting`에서 읽습니다.

## 6. 개인정보·보안 (01_ERD §6, 02 §7, BR-100)

- 🔒 표시 컬럼(연락처·상세주소 등)은 앱 레벨 암호화, 검색은 `*_hash` 컬럼으로만 합니다.
- 목록 화면은 항상 마스킹(`김*빈`, `010-****-7789`). 원문 열람·엑셀 다운로드는 `audit_log`에 기록합니다.
- 기사 위치는 동의 후 근무 시작~종료 사이에만 수집하고, 고객에게는 좌표 대신 도착 예정시각만 보여 줍니다(BR-115).
- 실제 개인정보·API 키·비밀번호를 코드, 시드, 테스트, 커밋에 넣지 않습니다. 비밀값은 환경변수로만 읽고 `.env*`는 커밋하지 않습니다(`.env.example`만 커밋).

## 7. 외부 연동

- 모든 외부 서비스(인증·파일 저장·PG·본인인증·알림톡/SMS·푸시·지도/길찾기·주소·증빙)는 `packages/integrations`의 **인터페이스 + Mock 구현 + Real 구현**으로 만듭니다. 환경변수로 전환합니다.
- 새 단계는 Mock으로 흐름 전체가 돌아간 뒤에 실연동합니다(04 §0 원칙 4).
- 경로 API 실패 시 직선거리 ÷ 25km/h 추정으로 대체합니다(F-TEC-RTE-02). 알림톡 실패 시 SMS로 대체합니다.

## 8. 디자인 시스템 (항상 준수)

[docs/05_디자인시스템.md](docs/05_디자인시스템.md)와 [docs/design-system/](docs/design-system/)을 따릅니다.

**토큰**
- 색·간격·반경·그림자·글꼴 크기는 `tokens.css`의 CSS 변수만 씁니다. 화면 코드에 `#1F5BD6` 같은 색 코드, 임의 px 반경, 임의 그림자를 직접 쓰지 않습니다.
- 화면 코드는 **의미 색상 토큰**(`--color-primary`, `--color-text-secondary`, `--color-danger` …)만 씁니다. 원시 색상(`--blue-600`, `--gray-300`)을 직접 참조하지 않습니다.
- Tailwind를 쓰면 `theme.extend`에서 CSS 변수를 참조합니다(05 §8.4). 임의값 클래스(`bg-[#…]`, `rounded-[13px]`)는 쓰지 않습니다.
- 값 변경은 `tokens.css`에서만 하고 `tokens.json`·미리보기를 맞춥니다(05 §9).

**채널**
- 루트에 `<html data-channel="customer|tech|admin">`을 지정해 채널 밀도를 적용합니다. 채널별 크기를 컴포넌트 안에서 따로 하드코딩하지 않습니다.
- 기사 앱: 터치 영역 최소 48px, 본문 16px, 큰 버튼, 진행 중 작업은 `.ac-live-banner`, 오프라인 상태는 `.ac-offline`.
- 관리자 웹: 1440px 기준, 검색 영역 Enter = 조회, 그리드 더블클릭 = 상세, 숫자·금액 열 `.is-num` 우측 정렬.

**컴포넌트**
- `components.css`의 `ac-` 컴포넌트(`.ac-btn`, `.ac-field`, `.ac-card`, `.ac-badge`, `.ac-table`, `.ac-modal`, `.ac-sheet`, `.ac-toast`, `.ac-bottom-bar` 등)를 쓰고, React 컴포넌트로 감쌀 때도 같은 클래스명·변형 이름을 유지합니다. 같은 역할의 새 컴포넌트를 따로 만들지 않습니다.
- Primary 버튼은 화면당 1개. 블루는 "누를 수 있음/선택됨"에만, 장식용 블루 금지. 블루가 과하면 `--dark`.
- 주문 상태 배지는 `tokens.json`의 `status` 맵(`labelCustomer`/`labelStaff`/`className`)으로만 렌더링합니다. 고객과 기사·관리자 표시명이 다릅니다(03 §6.1). 예약·작업 카드는 상태 배지를 좌상단에 둡니다. PENDING 48시간 경과는 `overdue48h` 클래스.
- 고객 스텝 플로우·결제 화면의 금액은 항상 `.ac-bottom-bar`에 표시합니다.
- 문구 형식: 저장 전 "저장하시겠습니까?", 저장 후 "저장에 성공하였습니다.", 필수 누락 "○○은(는) 필수 입력값입니다.", 빈 목록 "조회 결과가 없습니다."
- 브라우저 기본 `alert()`·`confirm()`·`prompt()`를 쓰지 않고 `.ac-modal`·`.ac-toast`·`.ac-alert`를 씁니다.
- 개인정보는 `.ac-masked` + [보기] 버튼(권한 있는 역할에만 렌더링, 클릭 시 감사 로그).

**글꼴·아이콘·접근성**
- 글꼴은 Pretendard, 금액·시간·건수·접수번호는 `.ac-num`(tabular-nums). 최소 글자 12px.
- 아이콘은 Lucide 한 세트로 통일합니다. 아이콘 버튼은 `aria-label` 필수.
- WCAG AA 대비 4.5:1, `:focus-visible` 포커스 링, 상태는 색 + 텍스트로 함께 표시, `aria-selected`/`aria-pressed`/`aria-invalid`/`role="dialog"` 지정, `prefers-reduced-motion` 존중.
- 특정 기업의 로고·상표·전용 폰트·고유 아이콘·브랜드 컬러를 쓰지 않습니다(05 §0.2).

## 9. 개발 명령

```bash
pnpm install
docker compose up -d db            # 또는 로컬 PostgreSQL 16
cp .env.example apps/web/.env.local  # 값 채우기 (AUTH_DRIVER=mock 이면 Supabase 없이 동작)
pnpm build --filter "./packages/*" # 공용 패키지 빌드
pnpm db:migrate && pnpm db:seed     # DATABASE_URL, SEED_SUPER_ADMIN_PASSWORD 필요
pnpm db:seed:demo                   # (선택) 테스트용 가상 데이터. PII_ENCRYPTION_KEY, PII_HASH_PEPPER, SEED_DEMO_PASSWORD 필요 (docs/07)
pnpm --filter @aircon/web dev       # http://localhost:3000/admin
pnpm typecheck && pnpm lint && pnpm test   # TEST_DATABASE_URL 이 있으면 RLS 통합 테스트 포함
pnpm e2e                            # 단계 완료 기준 E2E (E2E_DATABASE_URL)
```

## 10. 하지 말 것

- 문서 확인 없이 테이블·상태·화면 추가
- 상태 전이 함수를 거치지 않는 상태 컬럼 직접 UPDATE
- INSERT ONLY 테이블의 수정·삭제
- 색·크기·문구·기준값 하드코딩
- 실제 키·개인정보 커밋
- 실패하는 테스트를 건너뛰거나 지워서 통과시키기
