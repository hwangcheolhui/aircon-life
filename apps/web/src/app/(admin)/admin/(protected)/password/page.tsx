// A-AUTH-020 비밀번호 변경
import { requireAdmin } from '@/server/auth';
import { PasswordForm } from './password-form';

export default async function PasswordPage() {
  await requireAdmin();
  return (
    <div className="ac-stack" style={{ maxWidth: 480 }}>
      <h1 className="ac-h2">비밀번호 변경</h1>
      <PasswordForm />
    </div>
  );
}
