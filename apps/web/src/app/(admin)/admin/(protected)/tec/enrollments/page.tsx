// A-TEC-041 수강·수료 관리 · F-ADM-TEC-06: 과정별 수강생, 출석률·실습 점수, 판정(기준 system_setting TRAINING_PASS_*), 수료증 번호(과정코드-연도-순번)
// 기본과정 수료 시 교육중 기사 → 활동(활동 시작일 기록), 수료 알림(TRAINING_PASSED 푸시). 거점 범위(BR-102)
import { SETTING_KEYS } from '@aircon/domain';
import { Empty } from '@aircon/ui';
import Link from 'next/link';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getSettingNumber } from '@/server/settings';
import { enrollableTechs, listCourses, listEnrollments } from '@/server/training';
import { EnrollmentsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function EnrollmentsPage({ searchParams }: { searchParams: Promise<{ courseId?: string }> }) {
  const admin = await requireScreen('A-TEC-041');
  const filter = await currentBranchFilter(admin);
  const sp = await searchParams;
  const courseId = /^\d{1,15}$/.test(sp.courseId ?? '') ? Number(sp.courseId) : null;
  const [courses, codes] = await Promise.all([listCourses(filter), loadCodes(['COURSE_TYPE', 'COURSE_STATUS', 'ENROLLMENT_RESULT', 'TECH_STATUS'])]);
  const data = courseId ? await listEnrollments(courseId, admin, filter) : null;
  if (!data) {
    return (
      <div>
        <div className="adm-page-head">
          <h1 className="ac-h2">수강·수료 관리</h1>
        </div>
        <p className="ac-body">과정을 고르세요.</p>
        {courses.length ? (
          <ul className="ac-list">
            {courses.map((c) => (
              <li key={c.id} className="ac-list-item">
                <Link href={`/admin/tec/enrollments?courseId=${c.id}`} className="ac-list-item__body">
                  <span className="ac-num">{c.courseCode}</span> {c.name}
                </Link>
                <span className="ac-caption ac-num">
                  수강 {c.enrolled} · 수료 {c.passed}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </div>
    );
  }
  const [techs, passAttendance, passScore] = await Promise.all([enrollableTechs(filter), getSettingNumber(SETTING_KEYS.TRAINING_PASS_ATTENDANCE), getSettingNumber(SETTING_KEYS.TRAINING_PASS_SCORE)]);
  const flags = screenFlags(admin, 'A-TEC-041');
  const live = !admin.preview;
  const enrolledIds = new Set(data.rows.map((r) => r.technicianId));
  return (
    <EnrollmentsScreen
      course={{ id: data.course.id, code: data.course.courseCode, name: data.course.name, courseType: data.course.courseType, status: data.course.status, fee: data.course.fee, capacity: data.course.capacity }}
      courses={courses.map((c) => ({ value: String(c.id), label: `${c.courseCode} ${c.name}` }))}
      rows={data.rows}
      techs={techs.filter((t) => !enrolledIds.has(t.id)).map((t) => ({ value: String(t.id), label: `${t.name} (${t.techCode})` }))}
      codes={codes}
      passNote={`출석률 ${passAttendance}% 이상 · 실습 ${passScore}점 이상이면 수료`}
      canCreate={live && flags.canCreate}
      canUpdate={live && flags.canUpdate}
    />
  );
}
