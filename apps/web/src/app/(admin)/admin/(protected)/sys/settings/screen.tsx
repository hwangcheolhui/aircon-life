'use client';
import type { holiday, systemSetting } from '@aircon/db';
import { Tabs, Tag } from '@aircon/ui';
import { useState } from 'react';
import { CrudScreen } from '@/admin/crud-screen';
import { deleteHoliday, saveHoliday, saveSetting } from './actions';

type HolidayRow = typeof holiday.$inferSelect;
type SettingRow = typeof systemSetting.$inferSelect;
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

export function SettingsScreen(p: { holidays: HolidayRow[]; settings: SettingRow[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const [tab, setTab] = useState<'holiday' | 'setting'>('holiday');
  const tabs = (
    <Tabs
      value={tab}
      onChange={setTab}
      items={[
        { value: 'holiday', label: '공휴일' },
        { value: 'setting', label: '시스템 설정' },
      ]}
    />
  );
  if (tab === 'holiday') {
    const years = [...new Set(p.holidays.map((h) => h.holidayDate.slice(0, 4)))].map((y) => ({ value: y, label: `${y}년` }));
    return (
      <CrudScreen<HolidayRow>
        title="공휴일·시스템 설정"
        headerExtra={tabs}
        noun="공휴일"
        rows={p.holidays}
        rowKey={(r) => r.holidayDate}
        canCreate={p.canCreate}
        canUpdate={p.canUpdate}
        canDelete={p.canDelete}
        filters={[{ name: 'year', label: '연도', options: years, match: (r, v) => r.holidayDate.startsWith(v) }]}
        columns={[
          { header: '날짜', cell: (r) => <span className="ac-num">{r.holidayDate}</span> },
          { header: '요일', cell: (r) => WEEKDAY[new Date(`${r.holidayDate}T00:00:00`).getDay()] },
          { header: '명칭', cell: (r) => r.name },
          { header: '휴일 할증', cell: (r) => (r.isSurcharge ? <Tag tone="primary">적용</Tag> : <Tag>미적용</Tag>) },
        ]}
        defaults={{ isSurcharge: true }}
        toForm={(r) => ({ ...r })}
        fields={[
          { name: 'holidayDate', label: '공휴일', type: 'date', required: true, lockOnEdit: true },
          { name: 'name', label: '명칭', required: true },
          { name: 'isSurcharge', label: '휴일 할증 적용 (BR-012)', type: 'checkbox' },
        ]}
        save={saveHoliday}
        remove={deleteHoliday}
      />
    );
  }
  return (
    <CrudScreen<SettingRow>
      title="공휴일·시스템 설정"
      headerExtra={tabs}
      noun="설정"
      rows={p.settings}
      rowKey={(r) => r.settingKey}
      canCreate={false}
      canUpdate={p.canUpdate}
      canDelete={false}
      filters={[{ name: 'q', label: '설정 키·설명', match: (r, v) => `${r.settingKey} ${r.description ?? ''}`.toLowerCase().includes(v.toLowerCase()) }]}
      columns={[
        { header: '설정 키', cell: (r) => <span className="ac-num">{r.settingKey}</span> },
        { header: '설정값', cell: (r) => <strong className="ac-num">{r.settingValue}</strong> },
        { header: '설명', cell: (r) => r.description ?? '' },
        { header: '수정일시', cell: (r) => <span className="ac-num">{new Date(r.updatedAt).toLocaleString('ko-KR')}</span> },
      ]}
      toForm={(r) => ({ ...r })}
      fields={[
        { name: 'settingKey', label: '설정 키', required: true, lockOnEdit: true, span2: true },
        { name: 'settingValue', label: '설정값', required: true },
        { name: 'description', label: '설명' },
      ]}
      save={saveSetting}
    />
  );
}
