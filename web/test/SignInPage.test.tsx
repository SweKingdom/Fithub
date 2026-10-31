import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../src/api/auth';
import { ApiError } from '../src/api/client';
import { AuthProvider } from '../src/lib/auth';
import { SignInPage } from '../src/pages/SignInPage';

const mocks = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn(), getMe: vi.fn() }));
vi.mock('../src/api/auth', () => mocks);

const ME: Me = {
  id: 'u1',
  email: 'anna@example.com',
  fullName: 'Anna Berg',
  role: 'instructor',
  memberType: null,
  clubId: 'c1',
  clubName: 'Club One',
};

function Probe() {
  const location = useLocation();
  return <p data-testid="url">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(url = '/sign-in') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const emailField = () => screen.getByLabelText('Email') as HTMLInputElement;
const passwordField = () => screen.getByLabelText('Password') as HTMLInputElement;

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(emailField(), { target: { value: email } });
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('SignInPage (US-118 AC 11)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getMe.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
  });
  afterEach(cleanup);

  it('shows a form with labelled Email and Password fields', async () => {
    renderPage();
    await screen.findByLabelText('Email');
    expect(emailField().type).toBe('email');
    expect(emailField().getAttribute('autocomplete')).toBe('email');
    expect(passwordField().type).toBe('password');
    expect(passwordField().getAttribute('autocomplete')).toBe('current-password');
  });

  it('shows the API message in an alert on a wrong password; email stays, password is cleared', async () => {
    mocks.login.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'));
    renderPage();
    await screen.findByLabelText('Email');
    fillAndSubmit('anna@example.com', 'wrong-password-123');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Email or password is incorrect.');
    expect(emailField().value).toBe('anna@example.com');
    expect(passwordField().value).toBe('');
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the rate-limit message from the API', async () => {
    mocks.login.mockRejectedValue(
      new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Please wait 15 minutes and try again.'),
    );
    renderPage();
    await screen.findByLabelText('Email');
    fillAndSubmit('anna@example.com', 'x');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Too many sign-in attempts.');
  });

  it('shows a plain message when the call fails for another reason', async () => {
    mocks.login.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByLabelText('Email');
    fillAndSubmit('anna@example.com', 'x');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Something went wrong. Please try again.');
  });

  it('disables the button and shows "Signing in…" while the call is pending', async () => {
    mocks.login.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByLabelText('Email');
    fillAndSubmit('anna@example.com', 'correct-horse-battery');
    const button = (await screen.findByRole('button', { name: 'Signing in…' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('sends the email as typed (letter case kept; the API normalises it) and goes to / after a successful sign-in', async () => {
    mocks.login.mockResolvedValue(ME);
    renderPage();
    await screen.findByLabelText('Email');
    // An email input removes surrounding spaces itself; the API also accepts them (see auth.login.test.ts).
    fillAndSubmit('Anna@Example.com', 'correct-horse-battery');

    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
    expect(mocks.login).toHaveBeenCalledWith('Anna@Example.com', 'correct-horse-battery');
  });

  it('goes to the next path after sign-in when it is a same-site path', async () => {
    mocks.login.mockResolvedValue(ME);
    renderPage('/sign-in?next=%2Fschedule%3FclubId%3D1');
    await screen.findByLabelText('Email');
    fillAndSubmit('anna@example.com', 'correct-horse-battery');
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/schedule?clubId=1'));
  });

  it.each(['https%3A%2F%2Fevil.example', '%2F%2Fevil.example', '%2F%5Cevil.example'])(
    'ignores the unsafe next value %s',
    async (next) => {
      mocks.login.mockResolvedValue(ME);
      renderPage(`/sign-in?next=${next}`);
      await screen.findByLabelText('Email');
      fillAndSubmit('anna@example.com', 'correct-horse-battery');
      await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/'));
    },
  );
});
