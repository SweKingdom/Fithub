import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  createClass: vi.fn(),
  listClubs: vi.fn(),
  getInstructors: vi.fn(),
  me: { current: null as unknown },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ me: mocks.me.current }) }));
vi.mock('../src/api/classes', () => ({ createClass: mocks.createClass }));
vi.mock('../src/api/clubs', () => ({
  listClubs: mocks.listClubs,
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

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValid() {
  type('Name', 'Spinning 45');
  type('Date', '2099-11-02');
  type('Start time', '18:00');
  type('Duration (minutes)', '45');
  type('Max places', '20');
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create class' }));

describe('NewClassPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listClubs.mockResolvedValue([{ id: CLUB_ID, name: 'FitHub Södermalm', timezone: 'Europe/Stockholm' }]);
    mocks.getInstructors.mockResolvedValue([{ id: INSTRUCTOR_ID, fullName: 'Ida Instructor' }]);
  });

  it('AC 8: members see the "not allowed" page and no form', () => {
    signInAs('member');
    render(<NewClassPage />);
    expect(screen.getByText('You are not allowed to create classes.')).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('AC 8: an instructor sees the club read-only and no instructor picker', async () => {
    signInAs('instructor');
    render(<NewClassPage />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    await screen.findByLabelText('Name');
    expect(screen.getByText('FitHub Södermalm')).toBeTruthy();
    expect(screen.queryByLabelText('Instructor')).toBeNull();
    expect(mocks.getInstructors).not.toHaveBeenCalled();
  });

  it('AC 8: a club manager gets the instructor picker with "No instructor yet"', async () => {
    signInAs('club_manager');
    render(<NewClassPage />);
    await screen.findByLabelText('Instructor');
    expect(screen.getByRole('option', { name: 'No instructor yet' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Ida Instructor' })).toBeTruthy();
  });

  it('AC 8: an empty submit shows messages next to the fields and focuses the first invalid one', async () => {
    signInAs('instructor');
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    submit();

    expect(screen.getByText('A class must have a name.')).toBeTruthy();
    expect(screen.getByText('Enter a valid start date and time.')).toBeTruthy();
    expect(screen.getByText('The duration must be a whole number of minutes greater than 0.')).toBeTruthy();
    expect(screen.getByText('Max places must be a whole number.')).toBeTruthy();
    const name = screen.getByLabelText('Name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe('name-error');
    expect(document.activeElement).toBe(name);
    expect(mocks.createClass).not.toHaveBeenCalled();
  });

  it('AC 8: zero places shows the server-aligned message', async () => {
    signInAs('instructor');
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    fillValid();
    type('Max places', '0');
    submit();
    expect(screen.getByText('A class must have at least one place.')).toBeTruthy();
    expect(mocks.createClass).not.toHaveBeenCalled();
  });

  it('AC 8: a start time in the past is rejected before the request', async () => {
    signInAs('instructor');
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    fillValid();
    type('Date', '2001-01-01');
    submit();
    expect(screen.getByText('The start time must be in the future.')).toBeTruthy();
    expect(mocks.createClass).not.toHaveBeenCalled();
  });

  it('AC 8: a valid submit sends UTC time and numbers, then redirects with the flash message', async () => {
    signInAs('instructor');
    mocks.createClass.mockResolvedValue({ id: 'c1' });
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    fillValid();
    submit();

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
    render(<NewClassPage />);
    await screen.findByLabelText('Instructor');
    fillValid();
    submit();
    await waitFor(() => expect(mocks.createClass).toHaveBeenCalled());
    expect(mocks.createClass).toHaveBeenCalledWith(expect.objectContaining({ instructorId: null }));
  });

  it('AC 8: the button is disabled and reads "Creating…" while submitting', async () => {
    signInAs('instructor');
    mocks.createClass.mockReturnValue(new Promise(() => undefined));
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    fillValid();
    submit();
    const button = (await screen.findByRole('button', { name: 'Creating…' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('AC 8: server field errors are shown next to their field and focus moves there', async () => {
    signInAs('club_manager');
    mocks.createClass.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', [
        { field: 'instructorId', message: 'Choose an instructor from this club.' },
      ]),
    );
    render(<NewClassPage />);
    await screen.findByLabelText('Instructor');
    fillValid();
    submit();

    expect(await screen.findByText('Choose an instructor from this club.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Instructor'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows the server message in a banner on a 403', async () => {
    signInAs('instructor');
    mocks.createClass.mockRejectedValue(
      new ApiError(403, 'FORBIDDEN', 'You can only manage classes for your own club.'),
    );
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    fillValid();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('You can only manage classes for your own club.');
  });

  it('shows a banner with a plain message on a network error and lets the user retry', async () => {
    signInAs('instructor');
    mocks.createClass.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<NewClassPage />);
    await screen.findByLabelText('Name');
    fillValid();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Please try again.');
    expect((screen.getByRole('button', { name: 'Create class' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
