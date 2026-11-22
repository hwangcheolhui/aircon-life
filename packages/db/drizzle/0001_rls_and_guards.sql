-- 단계 0: RLS(행 수준 보안)와 INSERT ONLY 가드
-- 서버(Next.js 서버 액션)는 서버 전용 DB 연결로 접근하며 코드에서 권한을 검사한다(requirePermission).
-- RLS는 브라우저에 노출되는 anon/authenticated 키로 직접 접근하는 경우를 막는 2차 방어선이다.
-- auth.uid()는 Supabase Auth가 제공한다(로컬 PostgreSQL은 scripts/migrate.ts가 sql/local-auth-shim.sql을 먼저 적용).
CREATE OR REPLACE FUNCTION public.current_admin_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id FROM admin_user a
  WHERE a.auth_user_id = auth.uid() AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
$$;
--> statement-breakpoint
-- F-ADM-SYS-02 메뉴×행위 권한
CREATE OR REPLACE FUNCTION public.has_permission(p_menu text, p_action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_user a
    JOIN role_permission rp ON rp.role_id = a.role_id
    JOIN permission p ON p.id = rp.permission_id
    WHERE a.auth_user_id = auth.uid() AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
      AND p.menu_code = p_menu AND p.action = p_action
  )
$$;
--> statement-breakpoint
-- BR-102 거점 데이터 범위 (packages/domain rbac/access.ts canAccessBranch 와 같은 규칙)
CREATE OR REPLACE FUNCTION public.can_access_branch(p_branch bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_user a JOIN role r ON r.id = a.role_id
    WHERE a.auth_user_id = auth.uid() AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
      AND ((r.data_scope = 'ALL' AND a.branch_id IS NULL) OR (a.branch_id IS NOT NULL AND a.branch_id = p_branch))
  )
$$;
--> statement-breakpoint
-- 관리자라면 조회 가능 + 화면 권한으로 등록·수정·삭제하는 기준 데이터 테이블
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('branch', 'A-SYS-030'),
    ('role', 'A-SYS-020'),
    ('permission', 'A-SYS-020'),
    ('role_permission', 'A-SYS-020'),
    ('common_code', 'A-SYS-040'),
    ('holiday', 'A-SYS-050'),
    ('system_setting', 'A-SYS-050'),
    ('service_category', 'A-PRD-010'),
    ('service_product', 'A-PRD-011'),
    ('price_policy', 'A-PRD-020'),
    ('surcharge_rule', 'A-PRD-030'),
    ('service_option', 'A-PRD-040'),
    ('material', 'A-PRD-040')
  ) AS v(tbl, menu) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tbl);
    EXECUTE format('CREATE POLICY admin_select ON public.%I FOR SELECT TO authenticated USING (public.current_admin_id() IS NOT NULL)', t.tbl);
    EXECUTE format('CREATE POLICY admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_permission(%L, ''CREATE''))', t.tbl, t.menu);
    EXECUTE format('CREATE POLICY admin_update ON public.%I FOR UPDATE TO authenticated USING (public.has_permission(%L, ''UPDATE''))', t.tbl, t.menu);
    EXECUTE format('CREATE POLICY admin_delete ON public.%I FOR DELETE TO authenticated USING (public.has_permission(%L, ''DELETE''))', t.tbl, t.menu);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE public.service_area ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY area_select ON public.service_area FOR SELECT TO authenticated
  USING (public.has_permission('A-DSP-050', 'READ') AND public.can_access_branch(branch_id));
--> statement-breakpoint
CREATE POLICY area_insert ON public.service_area FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('A-DSP-050', 'CREATE') AND public.can_access_branch(branch_id));
--> statement-breakpoint
CREATE POLICY area_update ON public.service_area FOR UPDATE TO authenticated
  USING (public.has_permission('A-DSP-050', 'UPDATE') AND public.can_access_branch(branch_id))
  WITH CHECK (public.can_access_branch(branch_id));
--> statement-breakpoint
CREATE POLICY area_delete ON public.service_area FOR DELETE TO authenticated
  USING (public.has_permission('A-DSP-050', 'DELETE') AND public.can_access_branch(branch_id));
--> statement-breakpoint
ALTER TABLE public.admin_user ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY admin_user_select ON public.admin_user FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.has_permission('A-SYS-010', 'READ'));
--> statement-breakpoint
CREATE POLICY admin_user_insert ON public.admin_user FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('A-SYS-010', 'CREATE'));
--> statement-breakpoint
CREATE POLICY admin_user_update ON public.admin_user FOR UPDATE TO authenticated
  USING (public.has_permission('A-SYS-010', 'UPDATE'));
--> statement-breakpoint
CREATE POLICY admin_user_delete ON public.admin_user FOR DELETE TO authenticated
  USING (public.has_permission('A-SYS-010', 'DELETE'));
--> statement-breakpoint
ALTER TABLE public.attachment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attachment_select ON public.attachment FOR SELECT TO authenticated
  USING (public.current_admin_id() IS NOT NULL);
--> statement-breakpoint
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- 감사 로그 조회는 A-SYS-060(단계 8). 기록은 서버에서만 한다.
CREATE POLICY audit_select ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_permission('A-SYS-060', 'READ'));
--> statement-breakpoint
-- CLAUDE.md §5 INSERT ONLY: 감사 로그는 수정·삭제 불가
CREATE OR REPLACE FUNCTION public.forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% 테이블은 INSERT ONLY 입니다.', TG_TABLE_NAME;
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_insert_only BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
