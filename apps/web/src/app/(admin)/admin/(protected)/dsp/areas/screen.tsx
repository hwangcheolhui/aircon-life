'use client';
import type { serviceArea } from '@aircon/db';
import { Empty, Tag } from '@aircon/ui';
import { CrudScreen, type Option, labelOf, won } from '@/admin/crud-screen';
import type { AreaOpenDemand } from '@/server/area-open';
import { deleteArea, saveArea } from './actions';

type Row = typeof serviceArea.$inferSelect;
const YN: Option[] = [
  { value: 'Y', label: '가능' },
  { value: 'N', label: '불가' },
];

/** F-ADM-DSP-11 저장 후 안내 문구 */
function openNote(data: unknown): string | null {
  const d = data as { notified: number; failed: number } | undefined;
  if (!d) return null;
  if (d.failed < 0) return '오픈 알림 발송 중 오류가 있어 다음 배치에서 다시 보냅니다.';
  const parts = [];
  if (d.notified > 0) parts.push(`오픈 알림 ${d.notified}건을 보냈습니다.`);
  if (d.failed > 0) parts.push(`${d.failed}건은 실패해 다음 배치에서 다시 보냅니다.`);
  return parts.length ? parts.join(' ') : null;
}

export function AreasScreen(p: {
  rows: Row[];
  branches: Option[];
  waitingByCode: Record<string, number>;
  unregistered: AreaOpenDemand[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  return (
    <>
      <CrudScreen<Row>
        title="관할 지역 관리"
        noun="관할 지역"
        rows={p.rows}
        rowKey={(r) => r.id}
        canCreate={p.canCreate}
        canUpdate={p.canUpdate}
        canDelete={p.canDelete}
        filters={[
          {
            name: 'branch',
            label: '담당 거점',
            options: p.branches,
            match: (r, v) => String(r.branchId) === v,
          },
          {
            name: 'q',
            label: '지역명·법정동 코드',
            match: (r, v) => `${r.sido} ${r.sigungu} ${r.eupmyeondong} ${r.legalDongCode ?? ''}`.includes(v),
          },
          { name: 'yn', label: '서비스 가능', options: YN, match: (r, v) => r.isServiceable === (v === 'Y') },
        ]}
        columns={[
          { header: '담당 거점', cell: (r) => labelOf(p.branches, String(r.branchId)) },
          { header: '시도', cell: (r) => r.sido },
          { header: '시군구', cell: (r) => r.sigungu },
          { header: '읍면동', cell: (r) => r.eupmyeondong },
          { header: '법정동 코드', cell: (r) => <span className="ac-num">{r.legalDongCode ?? ''}</span> },
          {
            header: '서비스 가능',
            cell: (r) => (r.isServiceable ? <Tag tone="success">가능</Tag> : <Tag tone="danger">불가</Tag>),
          },
          { header: '원거리 출장비', num: true, cell: (r) => won(r.travelFee) },
          {
            header: '오픈 알림 대기',
            num: true,
            cell: (r) => (
              <span className="ac-num">{(r.legalDongCode && p.waitingByCode[r.legalDongCode]) || 0}건</span>
            ),
          },
        ]}
        savedNote={openNote}
        defaults={{
          isServiceable: true,
          travelFee: '0',
          branchId: p.branches.length === 1 ? p.branches[0]!.value : '',
        }}
        toForm={(r) => ({ ...r, branchId: String(r.branchId) })}
        fields={[
          {
            name: 'branchId',
            label: '담당 거점',
            type: 'select',
            required: true,
            options: p.branches,
            emptyOption: '선택',
          },
          { name: 'legalDongCode', label: '법정동 코드', inputMode: 'numeric', help: '숫자 10자리' },
          { name: 'sido', label: '시도', required: true },
          { name: 'sigungu', label: '시군구', required: true },
          { name: 'eupmyeondong', label: '읍면동', required: true },
          { name: 'travelFee', label: '원거리 출장비(원)', type: 'number', required: true },
          { name: 'isServiceable', label: '서비스 가능', type: 'checkbox' },
        ]}
        save={saveArea}
        remove={deleteArea}
      />
      <section className="adm-section" aria-labelledby="adm-open-demand">
        <h2 className="ac-h3" id="adm-open-demand">
          미등록 지역 오픈 알림 신청
        </h2>
        <p className="ac-caption">
          관할 지역에 없는 법정동으로 들어온 신청 건수입니다. 이 법정동을 관할 지역으로 등록하고 서비스
          가능으로 저장하면 신청자에게 오픈 알림이 나갑니다.
        </p>
        {p.unregistered.length === 0 ? (
          <Empty />
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">시도</th>
                  <th scope="col">시군구</th>
                  <th scope="col">읍면동</th>
                  <th scope="col">법정동 코드</th>
                  <th scope="col" className="is-num">
                    대기 건수
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.unregistered.map((d) => (
                  <tr key={d.legalDongCode}>
                    <td>{d.sido}</td>
                    <td>{d.sigungu}</td>
                    <td>{d.eupmyeondong}</td>
                    <td>
                      <span className="ac-num">{d.legalDongCode}</span>
                    </td>
                    <td className="is-num">
                      <span className="ac-num">{d.waiting}건</span>
                    </td>
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
