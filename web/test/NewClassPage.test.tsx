import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `ApiError`, `useAuth` and `getClubs` come from US-117/US-118 (`api/client.ts`, `lib/auth.tsx`, `api/clubs.ts`).
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  createClass: vi.fn(),
  getClubs: vi.fn(),
  getInstructors: vi.fn(),
  me: { current: null as unknown },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ me: mocks.me.current }) }));
vi.mock('../src/api/classes', () => ({ createClass: mocks.createClass }));
vi.mock('../src/api/clubs', () => ({
  getClubs: mocks.getClubs,
  getInstructors: mocks.getInstructors,
}));

import { ApiError } from '../src/api/client';
import NewClassPage from '../src/pages/NewClassPage';

const CLUB_ID = '11111111-1111-4111-8111-111111111111';
const INSTRUCTOR_ID = '22222222-2222-4222-8222-222222222222';

function signInAs(role: 'instructor' | 'club_manager' | 'member') {
  mocks.me.current = {
    id: 'u1',
    role,
    clubId: CLUB_ID,
    clubName: 'FitHub Södermalm',
    fullName: 'Test User',
  };
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Spinning 45');
  await user.type(screen.getByLabelText('Date'), '2099-11-02');
  await user.type(screen.getByLabelText('Start time'), '18:00');
  await user.type(screen.getByLabelText('Duration (minutes)'), '45');
  await user.type(screen.getByLabelText('Max places'), '20');
}

describe('NewClassPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClubs.mockResolvedValue([{ id: CLUB_ID, name: 'FitHub Södermalm', timezone: 'Europe/Stockholm' }]);
    mocks.getInstructors.mockResolvedValue([{ id: INSTRUCTOR_ID, fullName: 'Ida Instructor' }]);
  });

  it('AC 8: members see the "not allowed" page and no form', () => {
    signInAs('member');
    render(<NewClassPage />);
    expect(screen.getByText('You are not allowed to create classes.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('AC 8: an instructor sees the club read-only and no instructor picker', async () => {
    signInAs('instructor');
    render(<NewClassPage />);
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByText('FitHub Södermalm')).toBeInTheDocument();
    expect(screen.queryByLabelText('Instructor')).not.toBeInTheDocument();
    expect(mocks.getInstructors).not.toHaveBeenCalled();
  });

  it('AC 8: a club manager gets the instructor picker with "No instructor yet"', async () => {
    signInAs('club_manager');
    render(<NewClassPage />);
    const picker = await screen.findByLabelText('Instructor');
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'No instructor yet' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ida Instructor' })).toBeInTheDocument();
  });

  it('AC 8: an empty submit shows messages next to the fields and focuses the first invalid one', async () => {
    signInAs('instructor');
    const user = userEvent.setup();
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    await user.click(screen.getByRole('button', { name: 'Create class' }));

    expect(screen.getByText('A class must have a name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid start date and time.')).toBeInTheDocument();
    expect(screen.getByText('The duration must be a whole number of minutes greater than 0.')).toBeInTheDocument();
    expect(screen.getByText('Max places must be a whole number.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(mocks.createClass).not.toHaveBeenCalled();
  });

  it('AC 8: zero places shows the server-aligned message', async () => {
    signInAs('instructor');
    const user = userEvent.setup();
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    await fillValid(user);
    await user.clear(screen.getByLabelText('Max places'));
    await user.type(screen.getByLabelText('Max places'), '0');
    await user.click(screen.getByRole('button', { name: 'Create class' }));
    expect(screen.getByText('A class must have at least one place.')).toBeInTheDocument();
    expect(mocks.createClass).not.toHaveBeenCalled();
  });

  it('AC 8: a valid submit sends UTC time and numbers, then redirects with the flash message', async () => {
    signInAs('instructor');
    mocks.createClass.mockResolvedValue({ id: 'c1' });
    const user = userEvent.setup();
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create class' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.createClass).toHaveBeenCalledWith({
      clubId: CLUB_ID,
      name: 'Spinning 45',
      startAt: '2099-11-02T17:00:00.000Z',
      durationMinutes: 45,
      capacity: 20,
    });
    expect(mocks.navigate).toHaveBeenCalledWith(`/schedule?clubId=${CLUB_ID}`, {
      state: { flash: 'Class created.' },
    });
  });

  it('AC 8: a club manager sends null when no instructor is chosen', async () => {
    signInAs('club_manager');
    mocks.createClass.mockResolvedValue({ id: 'c1' });
    const user = userEvent.setup();
    render(<NewClassPage />);
    await screen.findByLabelText('Instructor');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create class' }));
    await waitFor(() => expect(mocks.createClass).toHaveBeenCalled());
    expect(mocks.createClass).toHaveBeenCalledWith(expect.objectContaining({ instructorId: null }));
  });

  it('AC 8: the button is disabled and reads "Creating…" while submitting', async () => {
    signInAs('instructor');
    mocks.createClass.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create class' }));
    const button = await screen.findByRole('button', { name: 'Creating…' });
    expect(button).toBeDisabled();
  });

  it('AC 8: server field errors are shown next to their field and focus moves there', async () => {
    signInAs('club_manager');
    mocks.createClass.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', [
        { field: 'instructorId', message: 'Choose an instructor from this club.' },
      ]),
    );
    const user = userEvent.setup();
    render(<NewClassPage />);
    await screen.findByLabelText('Instructor');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create class' }));

    expect(await screen.findByText('Choose an instructor from this club.')).toBeInTheDocument();
    expect(screen.getByLabelText('Instructor')).toHaveFocus();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows a banner with a plain message on a network error', async () => {
    signInAs('instructor');
    mocks.createClass.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create class' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByRole('button', { name: 'Create class' })).toBeEnabled();
  });
});
