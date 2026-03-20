import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

async function loginAction(formData: FormData) {
  'use server';
  const password = formData.get('password') as string;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    redirect('/admin/login?error=1');
  }
  (await cookies()).set('palpal_admin_session', process.env.ADMIN_SESSION_TOKEN!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  redirect('/admin');
}

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>palpal admin</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Courier New', monospace;
            background: #111;
            color: #e0e0e0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .box {
            background: #1a1a1a;
            border: 1px solid #2e2e2e;
            border-radius: 10px;
            padding: 2rem;
            width: 100%;
            max-width: 360px;
          }
          h1 { text-align: center; color: #f97316; margin-bottom: 1.5rem; font-size: 1.4rem; }
          label { display: block; font-size: 0.8rem; color: #777; margin-bottom: 0.35rem; }
          input {
            width: 100%;
            background: #222;
            border: 1px solid #2e2e2e;
            color: #e0e0e0;
            padding: 0.5rem 0.65rem;
            border-radius: 6px;
            font-family: inherit;
            font-size: 0.875rem;
            margin-bottom: 1rem;
          }
          input:focus { outline: none; border-color: rgba(249,115,22,0.5); }
          button {
            width: 100%;
            padding: 0.6rem;
            background: rgba(249,115,22,0.15);
            color: #fdba74;
            border: 1px solid rgba(249,115,22,0.3);
            border-radius: 6px;
            font-family: inherit;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
          }
          button:hover { background: rgba(249,115,22,0.25); }
          .err { color: #fca5a5; font-size: 0.8rem; text-align: center; margin-top: 0.75rem; }
        `}</style>
      </head>
      <body>
        <div className="box">
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
            {searchParams.error && (
              <p className="err">Incorrect password</p>
            )}
          </form>
        </div>
      </body>
    </html>
  );
}
