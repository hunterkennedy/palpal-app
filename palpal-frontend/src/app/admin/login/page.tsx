import { loginAction } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div style={{
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      background: 'radial-gradient(1000px 500px at 85% -10%, rgba(254,133,0,0.08), transparent 60%), #141311',
      color: '#d4cec4',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
    }}>
      <style>{`
        .login-box { box-sizing: border-box; background: #1b1916; border: 1px solid rgba(255,248,240,0.12); border-radius: 14px; padding: 2rem; width: 100%; max-width: 380px; box-shadow: 0 26px 80px rgba(0,0,0,0.45); }
        .login-brand { display: flex; align-items: center; gap: 10px; justify-content: center; margin-bottom: 1.75rem; }
        .login-mark { width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(135deg, #fe8500, #ffb457); color: #1a130a; font-weight: 800; display: grid; place-items: center; font-size: 16px; }
        .login-box h1 { color: #f4f0e9; margin: 0; font-size: 1.15rem; letter-spacing: -0.01em; font-weight: 650; }
        .login-box p.sub { text-align: center; color: #9a9389; font-size: 0.78rem; margin: 0 0 1.5rem; }
        .login-box label { display: block; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.08em; color: #9a9389; margin-bottom: 0.4rem; }
        .login-box input { box-sizing: border-box; width: 100%; background: #23201c; border: 1px solid rgba(255,248,240,0.12); color: #f4f0e9; padding: 0.6rem 0.7rem; border-radius: 8px; font-family: inherit; font-size: 0.875rem; margin-bottom: 1rem; outline: none; }
        .login-box input:focus { border-color: rgba(254,133,0,0.6); background: #2b2722; }
        .login-box button { width: 100%; padding: 0.65rem; background: #fe8500; color: #1b1207; border: 1px solid #fe8500; border-radius: 8px; font-family: inherit; font-size: 0.875rem; font-weight: 650; cursor: pointer; transition: background 0.15s; }
        .login-box button:hover { background: #ff9a2e; }
        .login-err { color: #fca5a5; font-size: 0.8rem; text-align: center; margin-top: 0.85rem; }
      `}</style>
      <div className="login-box">
        <div className="login-brand">
          <div className="login-mark">p</div>
          <h1>palpal control room</h1>
        </div>
        <p className="sub">Sign in to manage the pipeline</p>
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
