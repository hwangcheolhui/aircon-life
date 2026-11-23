'use client';
import type { notificationTemplate } from '@aircon/db';
import { Empty } from '@aircon/ui';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import { saveTemplate } from './actions';

type Row = typeof notificationTemplate.$inferSelect;
interface Log {
  id: number;
  templateCode: string | null;
  receiverPhoneMasked: string | null;
  channel: string;
  status: string;
  relatedId: number | null;
  sentAt: Date | null;
  createdAt: Date;
  failReason: string | null;
}

export function TemplatesScreen(p: {
  rows: Row[];
  logs: Log[];
  codes: Record<string, Option[]>;
  variables: string[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const { NOTIFICATION_CHANNEL: channel, NOTIFICATION_TARGET: target, NOTIFICATION_STATUS: status } = p.codes;
  return (
    <>
      <CrudScreen<Row>
        title="알림 템플릿·발송 이력"
        noun="템플릿"
        rows={p.rows}
        rowKey={(r) => r.id}
        canCreate={false}
        canUpdate={p.canUpdate}
        canDelete={false}
        columns={[
          { header: '템플릿 코드', cell: (r) => <span className="ac-num">{r.templateCode}</span> },
          { header: '제목', cell: (r) => r.title },
          { header: '채널', cell: (r) => labelOf(channel, r.channel) },
          { header: '대상', cell: (r) => labelOf(target, r.target) },
          { header: '카카오 템플릿 ID', cell: (r) => r.kakaoTemplateId ?? '' },
          { header: '사용', cell: (r) => (r.isActive ? '사용' : '미사용') },
        ]}
        toForm={(r) => ({ ...r, kakaoTemplateId: r.kakaoTemplateId ?? '' })}
        fields={[
          { name: 'channel', label: '채널', type: 'select', required: true, options: channel?.filter((c) => c.value === 'ALIMTALK' || c.value === 'SMS') },
          { name: 'title', label: '제목', required: true },
          { name: 'kakaoTemplateId', label: '카카오 템플릿 ID', help: '카카오 비즈채널에서 검수 받은 템플릿 ID. 없으면 문자로 보냅니다.' },
          { name: 'isActive', label: '사용', type: 'checkbox' },
          { name: 'body', label: '본문', type: 'textarea', required: true, help: `치환 변수: ${p.variables.map((v) => `#{${v}}`).join(' ')}` },
        ]}
        save={saveTemplate}
      />
      <section className="adm-section">
        <h2 className="ac-h3">최근 발송 이력</h2>
        {p.logs.length === 0 ? (
          <Empty />
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">일시</th>
                  <th scope="col">템플릿</th>
                  <th scope="col">수신 번호</th>
                  <th scope="col">채널</th>
                  <th scope="col">결과</th>
                  <th scope="col">실패 사유</th>
                </tr>
              </thead>
              <tbody>
                {p.logs.map((l) => (
                  <tr key={l.id}>
                    <td className="ac-num">{formatDateTime(l.sentAt ?? l.createdAt)}</td>
                    <td className="ac-num">{l.templateCode ?? ''}</td>
                    <td className="ac-num">{l.receiverPhoneMasked ?? ''}</td>
                    <td>{labelOf(channel, l.channel)}</td>
                    <td>{labelOf(status, l.status)}</td>
                    <td>{l.failReason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
