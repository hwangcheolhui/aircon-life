'use client';
import type { role } from '@aircon/db';
import { Alert, Button, ConfirmModal, Field, MSG, Select, Tabs, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import type { Option } from '@/admin/crud-screen';
import { saveRolePermissions } from './actions';

type RoleRow = typeof role.$inferSelect;
type MenuGroup = { name: string; screens: { id: string; name: string; stage: string }[] };

export function RolesScreen(p: {
  roles: RoleRow[];
  grants: Record<number, string[]>;
  menu: MenuGroup[];
  actions: Option[];
  scopes: Option[];
  canUpdate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [roleId, setRoleId] = useState(String(p.roles[0]?.id ?? ''));
  const current = p.roles.find((r) => String(r.id) === roleId);
  const [checked, setChecked] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(p.roles.map((r) => [String(r.id), new Set(p.grants[r.id] ?? [])])),
  );
  const [scope, setScope] = useState<Record<string, string>>(() => Object.fromEntries(p.roles.map((r) => [String(r.id), r.dataScope])));
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = checked[roleId] ?? new Set<string>();

  const toggle = (k: string) => {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setChecked({ ...checked, [roleId]: next });
  };

  const save = async () => {
    setConfirm(false);
    const res = await saveRolePermissions({
      roleId: Number(roleId),
      dataScope: scope[roleId] ?? 'ALL',
      permissions: [...set].map((k) => {
        const [menuCode, action] = k.split(':');
        return { menuCode: menuCode!, action: action! };
      }),
    });
    if (!res.ok) {
      setError(res.message ?? '저장하지 못했습니다.');
      return;
    }
    setError(null);
    toast(MSG.saved);
    router.refresh();
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">역할·권한</h1>
        {p.canUpdate ? (
          <Button variant="primary" onClick={() => setConfirm(true)}>
            저장
          </Button>
        ) : null}
      </div>
      <Tabs value={roleId} onChange={setRoleId} items={p.roles.map((r) => ({ value: String(r.id), label: r.name }))} />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          역할 코드 <strong className="ac-num">{current?.roleCode}</strong> · 체크한 권한 <strong className="ac-num">{set.size}</strong>개
        </span>
        <div style={{ minWidth: 240 }}>
          <Field label="데이터 범위" help="거점 소속 관리자는 범위와 관계없이 자기 거점만 봅니다(BR-102).">
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={scope[roleId] ?? 'ALL'} disabled={!p.canUpdate} onChange={(e) => setScope({ ...scope, [roleId]: e.target.value })}>
                {p.scopes.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      <div className="ac-table-wrap">
        <table className="ac-table adm-matrix">
          <thead>
            <tr>
              <th scope="col">화면</th>
              {p.actions.map((a) => (
                <th key={a.value} scope="col">
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.menu.map((g) => (
              <Fragment key={g.name}>
                <tr className="is-muted">
                  <td colSpan={p.actions.length + 1}>
                    <strong>{g.name}</strong>
                  </td>
                </tr>
                {g.screens.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="ac-num">{s.id}</span> {s.name} <span className="ac-caption">단계 {s.stage}</span>
                    </td>
                    {p.actions.map((a) => {
                      const k = `${s.id}:${a.value}`;
                      return (
                        <td key={a.value}>
                          <label className="ac-check">
                            <input
                              type="checkbox"
                              checked={set.has(k)}
                              disabled={!p.canUpdate}
                              onChange={() => toggle(k)}
                              aria-label={`${s.name} ${a.label}`}
                            />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmModal open={confirm} description={`${current?.name} 역할의 권한이 바뀝니다.`} onConfirm={save} onCancel={() => setConfirm(false)} />
    </div>
  );
}
