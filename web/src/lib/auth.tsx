import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getMe, login, logout, type Me } from '../api/auth';
import { ApiError, setUnauthenticatedListener } from '../api/client';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  /** The signed-in user, or null while loading and when anonymous. */
  user: Me | null;
  /** Same as `user`; the name the schedule page uses. */
  me: Me | null;
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<Me>;
  signOut: () => Promise<void>;
  /** Called when the API says the session is gone: the user becomes anonymous and the router sends them to sign in. */
  onUnauthenticated: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const onUnauthenticated = useCallback(() => {
    setUser(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    let active = true;
    getMe()
      .then((me) => {
        if (!active) return;
        setUser(me);
        setStatus('authenticated');
      })
      .catch((error: unknown) => {
        if (!active) return;
        // 401 = nobody signed in. Any other failure also shows the sign-in page, which reports errors on submit.
        if (!(error instanceof ApiError)) console.error('Could not load the signed-in user.', error);
        setUser(null);
        setStatus('anonymous');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setUnauthenticatedListener(onUnauthenticated);
    return () => setUnauthenticatedListener(null);
  }, [onUnauthenticated]);

  const signIn = useCallback(async (email: string, password: string) => {
    const me = await login(email, password);
    setUser(me);
    setStatus('authenticated');
    return me;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      // The session then ends by itself (idle timeout); this browser still stops treating the user as signed in.
      console.error('The sign-out request failed.', error);
    }
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, me: user, status, signIn, signOut, onUnauthenticated }),
    [user, status, signIn, signOut, onUnauthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
