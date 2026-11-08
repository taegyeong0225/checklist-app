import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => subscription.unsubscribe();
  }, []);

  if (!supabase) {
    return <div className="auth-page">Supabase 연결 설정이 없습니다. `.env.local`을 확인하세요.</div>;
  }

  if (session === undefined) return <div className="auth-page">불러오는 중...</div>;
  if (session) return children;

  function credentials() {
    const normalizedId = userId.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,30}$/.test(normalizedId)) {
      throw new Error('아이디는 영문 소문자, 숫자, 밑줄(_), 하이픈(-)으로 3~30자 입력하세요.');
    }
    if (password.length < 4) throw new Error('비밀번호는 4자 이상 입력하세요.');
    return {
      email: `${normalizedId}@checklist.local`,
      password: `${password}::equipment-checklist`,
    };
  }

  async function submit(isSignUp) {
    setBusy(true);
    setMessage('');
    try {
      const input = credentials();
      const action = isSignUp ? supabase.auth.signUp(input) : supabase.auth.signInWithPassword(input);
      const { error } = await action;
      setMessage(error ? error.message : isSignUp ? '가입되었습니다. 이제 로그인하세요.' : '');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>설비 통신 확인 체크리스트</h1>
        <p>휴대폰과 iPad에서 같은 아이디로 로그인하세요.</p>
        <input className="form-input" autoComplete="username" placeholder="아이디 (영문/숫자/_/-)" value={userId} onChange={(e) => setUserId(e.target.value)} />
        <input className="form-input" type="password" minLength="4" autoComplete="current-password" placeholder="비밀번호 (4자 이상)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="auth-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => submit(false)}>로그인</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => submit(true)}>가입</button>
        </div>
        {message && <p className="auth-message">{message}</p>}
      </section>
    </main>
  );
}
