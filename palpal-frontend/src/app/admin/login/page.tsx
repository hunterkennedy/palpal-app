import { loginAction } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div style={{
      fontFamily: "'Courier New', monospace",
      background: '#111',
      color: '#e0e0e0',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <style>{`
        .login-box { box-sizing: border-box; background: #1a1a1a; border: 1px solid #2e2e2e; border-radius: 10px; padding: 2rem; width: 100%; max-width: 360px; }
        .login-box h1 { text-align: center; color: #f97316; margin-bottom: 1.5rem; font-size: 1.4rem; }
        .login-box label { display: block; font-size: 0.8rem; color: #777; margin-bottom: 0.35rem; }
        .login-box input { box-sizing: border-box; width: 100%; background: #222; border: 1px solid #2e2e2e; color: #e0e0e0; padding: 0.5rem 0.65rem; border-radius: 6px; font-family: inherit; font-size: 0.875rem; margin-bottom: 1rem; }
        .login-box input:focus { outline: none; border-color: rgba(249,115,22,0.5); }
        .login-box button { width: 100%; padding: 0.6rem; background: rgba(249,115,22,0.15); color: #fdba74; border: 1px solid rgba(249,115,22,0.3); border-radius: 6px; font-family: inherit; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
        .login-box button:hover { background: rgba(249,115,22,0.25); }
        .login-err { color: #fca5a5; font-size: 0.8rem; text-align: center; margin-top: 0.75rem; }
      `}</style>
      <div className="login-box">
        <h1>palpal admin</h1>
        <form action={loginAction}>
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            name="password"
            autoComplete="current-password"
            autoFocus
          />
          <button type="submit">Sign in</button>
          {error && (
            <p className="login-err">Incorrect password</p>
          )}
        </form>
      </div>
    </div>
  );
}
