import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '../api/auth';
import { useAuth } from '../lib/auth';

interface RequireAuthProps {
  children: ReactNode;
  /** When set, other roles see a message instead of the page. The API enforces the same rule. */
  roles?: Role[];
}

/** Shows its children to signed-in users; anonymous users are sent to `/sign-in?next=<path>`. */
export function RequireAuth({ children, roles }: RequireAuthProps) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <p>Loading…</p>;
  if (status === 'anonymous' || user === null) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <p role="alert">You don't have access to this page.</p>;
  }
  return <>{children}</>;
}
