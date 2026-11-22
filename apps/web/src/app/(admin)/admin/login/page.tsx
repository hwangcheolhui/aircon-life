// A-AUTH-010 로그인 (ID/PW, 잠금 안내) · F-ADM-SYS-01
import { Alert } from '@aircon/ui';
import { DB_OFFLINE_MESSAGE, isDbConfigured } from '@/server/db';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default function AdminLoginPage() {
  return (
    <main className="adm-login">
      {isDbConfigured() ? null : <Alert tone="warning">{DB_OFFLINE_MESSAGE}</Alert>}
      <LoginForm />
    </main>
  );
}
