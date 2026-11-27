// T-MY-010 내 정보 · F-TEC-MY-01: 프로필(고객 노출 이름·소개), 정산 계좌(마스킹), 활동지역, 숙련, 비밀번호
// 계좌·활동지역·숙련 변경은 거점(관리자 A-TEC-020)에서 한다. 단계 10: 퀵메뉴 설정(T-MY-020)·내 교육·등급(T-EDU-020) 바로가기
import { Card, Empty, Tag } from '@aircon/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { getTechProfile } from '@/server/tech-jobs';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { IntroForm, PasswordForm } from './my-forms';

export const metadata = { title: '내 정보' };

export default async function TechMyPage() {
  const me = await requireTech();
  const p = await getTechProfile(me.id);
  if (!p) notFound();
  const codes = await loadCodes(['TECH_GRADE', 'DEVICE_TYPE', 'SKILL_LEVEL', 'BANK_CODE']);
  const label = (g: string, v: string | null) =>
    v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '';
  return (
    <main className="tec-page__body">
      <TechTopbar title="내 정보" back={{ href: '/tech/more', label: '더보기' }} />
      <div className="tec-btn-row">
        <Link href="/tech/my/quick-menu" className="ac-btn ac-btn--outline">
          퀵메뉴 설정
        </Link>
        <Link href="/tech/education" className="ac-btn ac-btn--outline">
          내 교육·등급
        </Link>
      </div>
      <Card>
        <dl className="tec-kv ac-body">
          <dt>이름</dt>
          <dd>
            {p.name} {p.displayName ? <span className="ac-caption">(고객에게 {p.displayName})</span> : null}
          </dd>
          <dt>기사 코드</dt>
          <dd className="ac-num">{p.techCode}</dd>
          <dt>소속·등급</dt>
          <dd>
            {p.branchName} · {label('TECH_GRADE', p.grade)}
            {p.grade === 'TRAINEE' ? (
              <span className="ac-caption ac-num">
                {' '}
                (동행 {Math.min(p.accompanyDone, p.accompanyRequired)}/{p.accompanyRequired})
              </span>
            ) : null}
          </dd>
          <dt>연락처</dt>
          <dd className="ac-masked ac-num">{p.phoneMasked}</dd>
          <dt>정산 계좌</dt>
          <dd>
            {p.bankAccountMasked ? (
              <span className="ac-masked ac-num">
                {`${p.bankCode ?? ''} ${p.bankAccountMasked} ${p.accountHolder ?? ''}`.trim()}
              </span>
            ) : (
              '등록 전'
            )}
          </dd>
        </dl>
        <p className="ac-caption">계좌·연락처 변경은 소속 거점에 요청해 주세요.</p>
      </Card>

      <section className="tec-section" aria-labelledby="intro-title">
        <h2 id="intro-title" className="ac-h3">
          고객에게 보이는 소개
        </h2>
        <IntroForm intro={p.intro ?? ''} />
      </section>

      <section className="tec-section" aria-labelledby="area-title">
        <h2 id="area-title" className="ac-h3">
          활동지역
        </h2>
        {p.areas.length ? (
          <div className="ac-chip-row" role="list">
            {p.areas.map((a) => (
              <span key={a.code} role="listitem">
                <Tag tone={a.priority === 1 ? 'primary' : undefined}>
                  {a.label}
                  {a.priority === 2 ? ' (보조)' : ''}
                </Tag>
              </span>
            ))}
          </div>
        ) : (
          <Empty>지정된 활동지역이 없습니다.</Empty>
        )}
      </section>

      <section className="tec-section" aria-labelledby="skill-title">
        <h2 id="skill-title" className="ac-h3">
          숙련
        </h2>
        {p.skills.length ? (
          <ul className="ac-list">
            {p.skills.map((s) => (
              <li key={s.deviceType} className="ac-list-item">
                <span className="ac-list-item__body ac-body">{label('DEVICE_TYPE', s.deviceType)}</span>
                <Tag>{label('SKILL_LEVEL', s.skillLevel)}</Tag>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>등록된 숙련이 없습니다.</Empty>
        )}
      </section>

      <section className="tec-section" aria-labelledby="pw-title">
        <h2 id="pw-title" className="ac-h3">
          {p.hasPassword ? '비밀번호 바꾸기' : '비밀번호 만들기'}
        </h2>
        <p className="ac-caption">
          비밀번호가 있으면 인증번호 없이 휴대폰 번호와 비밀번호로 로그인할 수 있어요.
        </p>
        <PasswordForm />
      </section>
    </main>
  );
}
