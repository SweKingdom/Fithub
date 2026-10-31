import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/** Shows who is signed in and the "Sign out" button. Renders nothing for anonymous users. */
export function AppHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  if (user === null) return null;

  async function handleSignOut(): Promise<void> {
    await signOut();
    navigate('/sign-in', { replace: true });
  }

  return (
    <header>
      <span>{user.fullName}</span>
      <button type="button" onClick={() => void handleSignOut()}>
        Sign out
      </button>
    </header>
  );
}
