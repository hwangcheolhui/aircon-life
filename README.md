# aircon-life

에어컨 청소 기반 지역생활서비스 플랫폼 — 고객 웹(`/`) · 기사 웹앱(`/tech`) · 관리자 웹(`/admin`).

- 설계 문서: [docs/](docs/) (01 ERD · 02 기능정의서 · 03 IA · 04 구현계획 · 05 디자인시스템 · 06 기술 스택)
- 작업 규칙: [CLAUDE.md](CLAUDE.md)
- 스택: Next.js(App Router, Vercel) · Supabase(Auth · PostgreSQL · Storage) · Drizzle · pnpm + Turborepo

## 로컬 실행

```bash
pnpm install
docker compose up -d db                      # PostgreSQL 16 + PostGIS
cp .env.example apps/web/.env.local          # SESSION_SECRET, PII_ENCRYPTION_KEY 채우기
pnpm turbo run build --filter="./packages/*"
export DATABASE_URL=postgres://aircon:aircon@localhost:5432/aircon
pnpm db:migrate
SESSION_SECRET=... MOCK_AUTH_FILE=../../apps/web/storage/mock-auth.json SEED_SUPER_ADMIN_PASSWORD=... pnpm db:seed
# (선택) 테스트용 가상 데이터·테스트 계정 — docs/07_테스트데이터.md
SESSION_SECRET=... MOCK_AUTH_FILE=../../apps/web/storage/mock-auth.json PII_ENCRYPTION_KEY=... PII_HASH_PEPPER=... SEED_DEMO_PASSWORD=... pnpm db:seed:demo
pnpm --filter @aircon/web dev                # http://localhost:3000/admin
```

`AUTH_DRIVER=mock`(기본)이면 Supabase 없이 로그인까지 동작합니다. 실제 Supabase를 쓰려면 `AUTH_DRIVER=supabase`와 `SUPABASE_*` 값을 넣고 같은 순서로 마이그레이션·시드를 실행합니다.

## 검사

```bash
pnpm typecheck && pnpm lint && pnpm test     # TEST_DATABASE_URL 이 있으면 RLS 통합 테스트 포함
pnpm e2e                                      # 04 단계 0·1 완료 기준 시나리오
```
