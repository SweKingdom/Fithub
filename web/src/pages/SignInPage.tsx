import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../lib/auth';
import { safeNext } from '../lib/safe-next';

const GENERIC_ERROR = 'Something went wrong. Please try again.';

export function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate(safeNext(searchParams.get('next')), { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : GENERIC_ERROR);
      // The email stays so it can be corrected; the password never does.
      setPassword('');
      setPending(false);
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={(event) => void handleSubmit(event)}>
        {error !== null && <p role="alert">{error}</p>}

        <label htmlFor="sign-in-email">Email</label>
        <input
          id="sign-in-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="sign-in-password">Password</label>
        <input
          id="sign-in-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
