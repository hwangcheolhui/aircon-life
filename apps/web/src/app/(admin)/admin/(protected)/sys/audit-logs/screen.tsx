'use client';
// A-SYS-060 감사 로그: 검색 Enter = 조회 (조회 전용)
import { Button, Empty, Field, Input, Select } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listAuditLogs } from '@/server/purge';

type Row = Awaited<ReturnType<typeof listAuditLogs>>[number];
type Q = { action: string | null; targetTable: string | null; actorKeyword: string | null; dateFrom: string; dateTo: string };

export function AuditLogsScreen({ rows, query, codes }: { rows: Row[]; query: Q; codes: Record<string, Option[]> }) {
  const router = useRouter();
  const [f, setF] = useState({ action: query.action ?? '', table: query.targetTable ?? '', actor: query.actorKeyword ?? '', from: query.dateFrom, to: query.dateTo });
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">감사 로그</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
          router.push(`/admin/sys/audit-logs?${sp.toString()}`);
        }}
      >
        <Field label="기간(시작)">{(id) => <Input id={id} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
        <Field label="기간(종료)">{(id) => <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        <Field label="행위">
          {(id) => (
            <Select id={id} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
              <option value="">전체</option>
              {codes.AUDIT_ACTION?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="대상 테이블">{(id) => <Input id={id} placeholder="예: customer" value={f.table} onChange={(e) => setF({ ...f, table: e.target.value })} />}</Field>
        <Field label="행위자(이름·아이디)">{(id) => <Input id={id} value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />}</Field>
        <div className="ac-search-panel__actions">
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{rows.length.toLocaleString()}</strong>건 (최대 500건)
        </span>
      </div>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">일시</th>
                <th scope="col">행위자</th>
                <th scope="col">행위</th>
                <th scope="col">대상</th>
                <th scope="col">IP</th>
                <th scope="col">내용</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ac-num">{formatDateTime(new Date(r.createdAt))}</td>
                  <td>
                    {labelOf(codes.ACTOR_TYPE, r.actorType)} · {r.actorName}
                    {r.actorLogin ? <span className="ac-caption"> ({r.actorLogin})</span> : null}
                  </td>
                  <td>{labelOf(codes.AUDIT_ACTION, r.action)}</td>
                  <td className="ac-num">{r.targetTable ? `${r.targetTable}${r.targetId ? ` #${r.targetId}` : ''}` : '-'}</td>
                  <td className="ac-num">{r.ipAddress ?? '-'}</td>
                  <td className="adm-csl-ellipsis ac-caption">{r.detail ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
