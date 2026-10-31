import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../src/api/auth';
import { ApiError, apiFetch } from '../src/api/client';
import { AppHeader } from '../src/components/AppHeader';
import { RequireAuth } from '../src/components/RequireAuth';
import { AuthProvider } from '../src/lib/auth';

const mocks = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn(), getMe: vi.fn() }));
vi.mock('../src/api/auth', () => mocks);

const MEMBER: Me = {
  id: 'u1',
  email: 'mia@example.com',
  fullName: 'Mia Member',
  role: 'member',
  memberType: 'regular',
  clubId: null,
  clubName: null,
  bookingBlock: null,
};

function Probe() {
  const location = useLocation();
  return <p data-testid="url">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(url: string, roles?: Me['role'][]) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<Probe />} />
          <Route
            path="*"
            element={
              <RequireAuth roles={roles}>
                <AppHeader />
                <p>Protected content</p>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const currentUrl = () => screen.getByTestId('url').textContent ?? '';

describe('RequireAuth and AppHeader (US-118 AC 11)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(cleanup);

  it('shows "Loading…" while the signed-in user is being loaded', () => {
    mocks.getMe.mockReturnValue(new Promise(() => undefined));
    renderAt('/');
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('sends an anonymous user to /sign-in?next=<path>', async () => {
    mocks.getMe.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
    renderAt('/schedule?clubId=1');
    await waitFor(() => expect(currentUrl()).toBe('/sign-in?next=%2Fschedule%3FclubId%3D1'));
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('shows the page and the header with the full name to a signed-in user', async () => {
    mocks.getMe.mockResolvedValue(MEMBER);
    renderAt('/');
    expect(await screen.findByText('Protected content')).toBeTruthy();
    expect(screen.getByText('Mia Member')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('shows "You don\'t have access to this page." when the role is not allowed', async () => {
    mocks.getMe.mockResolvedValue(MEMBER);
    renderAt('/', ['instructor', 'club_manager']);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("You don't have access to this page.");
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('lets an allowed role in', async () => {
    mocks.getMe.mockResolvedValue({ ...MEMBER, role: 'instructor', memberType: null });
    renderAt('/', ['instructor', 'club_manager']);
    expect(await screen.findByText('Protected content')).toBeTruthy();
  });

  it('signs out and ends up on /sign-in', async () => {
    mocks.getMe.mockResolvedValue(MEMBER);
    mocks.logout.mockResolvedValue(undefined);
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(currentUrl().startsWith('/sign-in')).toBe(true));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('treats the user as signed out even when the sign-out call fails', async () => {
    mocks.getMe.mockResolvedValue(MEMBER);
    mocks.logout.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(currentUrl().startsWith('/sign-in')).toBe(true));
  });

  it('sends the user to sign in when any later API call answers 401', async () => {
    mocks.getMe.mockResolvedValue(MEMBER);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    try {
      renderAt('/schedule');
      await screen.findByText('Protected content');
      await expect(apiFetch('/api/clubs')).rejects.toBeInstanceOf(ApiError);
      await waitFor(() => expect(currentUrl()).toBe('/sign-in?next=%2Fschedule'));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
