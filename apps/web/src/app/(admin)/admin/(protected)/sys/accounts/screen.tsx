'use client';
import { Masked, Tag, useToast } from '@aircon/ui';
import { CrudScreen, type FormValues, type Option, labelOf } from '@/admin/crud-screen';
import { deleteAccount, getAccountDetail, saveAccount } from './actions';

export interface AccountRow {
  id: number;
  loginId: string;
  name: string;
  phone: string;
  email: string;
  roleId: number;
  roleName: string;
  branchName: string | null;
  status: string;
  lastLoginAt: string | null;
  loginFailCount: number;
}

export function AccountsScreen(p: {
  rows: AccountRow[];
  roles: Option[];
  branches: Option[];
  codes: Record<string, Option[]>;
  selfId: number;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const status = p.codes.ADMIN_STATUS;
  const toast = useToast();
  return (
    <CrudScreen<AccountRow>
      title="관리자 계정"
      noun="관리자 계정"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      filters={[
        { name: 'q', label: 'ID', match: (r, v) => r.loginId.toLowerCase().includes(v.toLowerCase()) },
        { name: 'role', label: '역할', options: p.roles, match: (r, v) => String(r.roleId) === v },
        { name: 'status', label: '계정 상태', options: status, match: (r, v) => r.status === v },
      ]}
      columns={[
        { header: 'ID', cell: (r) => r.loginId },
        { header: '이름', cell: (r) => <span className="ac-masked">{r.name}</span> },
        {
          header: '연락처',
          cell: (r) => (
            <Masked
              masked={r.phone}
              canView={p.canUpdate}
              onView={async () => {
                const res = await getAccountDetail(String(r.id)); // 감사 로그 VIEW_PII
                return res.ok ? String((res.data as { phone: string }).phone) : null;
              }}
            />
          ),
        },
        { header: '이메일', cell: (r) => <span className="ac-masked">{r.email}</span> },
        { header: '역할', cell: (r) => r.roleName },
        { header: '소속 거점', cell: (r) => r.branchName ?? '본사(전체)' },
        {
          header: '상태',
          cell: (r) => <Tag tone={r.status === 'LOCKED' ? 'danger' : r.status === 'ACTIVE' ? 'success' : undefined}>{labelOf(status, r.status)}</Tag>,
        },
        { header: '실패', num: true, cell: (r) => r.loginFailCount },
        { header: '최근 로그인', cell: (r) => <span className="ac-num">{r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString('ko-KR') : ''}</span> },
      ]}
      rowClassName={(r) => (r.status === 'LOCKED' ? 'is-highlight' : undefined)}
      toForm={() => ({})}
      loadDetail={async (r) => {
        const res = await getAccountDetail(String(r.id));
        if (!res.ok) toast(res.message ?? '권한이 없습니다.');
        return res.ok ? (res.data as FormValues) : null;
      }}
      fields={[
        { name: 'loginId', label: 'ID', required: true, lockOnEdit: true },
        { name: 'name', label: '이름', required: true },
        { name: 'email', label: '이메일(로그인 계정)', type: 'email', required: true },
        { name: 'phone', label: '연락처', inputMode: 'tel' },
        { name: 'roleId', label: '역할', type: 'select', required: true, options: p.roles, emptyOption: '선택' },
        { name: 'branchId', label: '소속 거점', type: 'select', options: p.branches, emptyOption: '본사(전체)', help: '거점을 지정하면 그 거점 데이터만 봅니다(BR-102).' },
        { name: 'initialPassword', label: '초기 비밀번호', type: 'password', required: true, createOnly: true },
        { name: 'status', label: '계정 상태', type: 'select', required: true, options: status, editOnly: true, help: '잠김 → 사용으로 바꾸면 잠금이 해제됩니다.' },
        { name: 'newPassword', label: '비밀번호 초기화', type: 'password', editOnly: true, help: '입력할 때만 바뀝니다.' },
      ]}
      save={saveAccount}
      remove={deleteAccount}
    />
  );
}
