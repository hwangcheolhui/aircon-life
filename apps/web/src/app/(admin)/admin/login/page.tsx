// A-AUTH-010 로그인 (ID/PW, 잠금 안내) · F-ADM-SYS-01
import { LoginForm } from './login-form';

export default function AdminLoginPage() {
  return (
    <main className="adm-login">
      <LoginForm />
    </main>
  );
}
