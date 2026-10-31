import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceItem, AttendanceRoster } from '../src/api/attendance';
import { ApiError } from '../src/api/client';
import { ClassAttendancePage } from '../src/pages/ClassAttendancePage';

const mocks = vi.hoisted(() => ({
  getAttendance: vi.fn(),
  saveAttendance: vi.fn(),
  onUnauthenticated: vi.fn(),
}));

vi.mock('../src/api/attendance', () => ({
  getAttendance: mocks.getAttendance,
  saveAttendance: mocks.saveAttendance,
}));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ onUnauthenticated: mocks.onUnauthenticated }) }));

const CLASS_ID = 'c0000000-0000-4000-8000-000000000001';

function item(n: number, name: string, attendance: AttendanceItem['attendance'] = 'unknown'): AttendanceItem {
  return {
    bookingId: `b0000000-0000-4000-8000-00000000000${n}`,
    memberId: `m0000000-0000-4000-8000-00000000000${n}`,
    memberName: name,
    attendance,
    recordedAt: attendance === 'unknown' ? null : '2026-10-30T09:10:00.000Z',
    recordedByName: attendance === 'unknown' ? null : 'Ida Instructor',
  };
}

function roster(items: AttendanceItem[], overrides: Partial<AttendanceRoster> = {}): AttendanceRoster {
  return {
    classId: CLASS_ID,
    className: 'Yoga',
    startAt: '2026-10-30T09:00:00.000Z',
    endsAt: '2026-10-30T10:00:00.000Z',
    clubTimezone: 'Europe/Stockholm',
    classStatus: 'scheduled',
    window: { opensAt: '2026-10-30T09:00:00.000Z', closesAt: '2026-10-31T10:00:00.000Z', state: 'open' },
    canEdit: true,
    summary: {
      booked: items.length,
      attended: items.filter((i) => i.attendance === 'attended').length,
      noShows: items.filter((i) => i.attendance === 'no_show').length,
      unknown: items.filter((i) => i.attendance === 'unknown').length,
    },
    items,
    ...overrides,
  };
}

const ANA = item(1, 'Ana Pérez');
const BO = item(2, 'Bo Berg');
const CY = item(3, 'Cy Carlsson');

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/classes/${CLASS_ID}/attendance`]}>
      <Routes>
        <Route path="/classes/:classId/attendance" element={<ClassAttendancePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const group = (name: string) => within(screen.getByRole('radiogroup', { name }));
const saveButton = () => screen.getByRole('button', { name: /^(Save|Saving…)$/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ClassAttendancePage (US-129 AC 9)', () => {
  it('shows a loading state, then the header, summary and one radio group per member', async () => {
    mocks.getAttendance.mockResolvedValue(roster([ANA, BO, CY]));
    renderPage();
    expect(screen.getByText('Loading attendance…')).toBeTruthy();

    expect(await screen.findByText('Yoga')).toBeTruthy();
    expect(mocks.getAttendance).toHaveBeenCalledWith(CLASS_ID);
    expect(screen.getByText(/Booked 3 · Attended 0 · No-show 0 · Not recorded\s+3/)).toBeTruthy();
    expect(screen.getByText(/Friday 30 October, 10:00–11:00/)).toBeTruthy();
    for (const name of ['Ana Pérez', 'Bo Berg', 'Cy Carlsson']) {
      expect(screen.getByRole('radiogroup', { name })).toBeTruthy();
    }
    // Nothing is selected for a member that is not recorded yet.
    expect((group('Ana Pérez').getByLabelText('Attended') as HTMLInputElement).checked).toBe(false);
    expect((group('Ana Pérez').getByLabelText('No-show') as HTMLInputElement).checked).toBe(false);
  });

  it('shows the recorded value and who recorded it', async () => {
    mocks.getAttendance.mockResolvedValue(roster([item(1, 'Ana Pérez', 'no_show'), BO]));
    renderPage();
    await screen.findByText('Yoga');
    expect((group('Ana Pérez').getByLabelText('No-show') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Recorded by Ida Instructor')).toBeTruthy();
  });

  it('"Mark all attended" selects Attended only for rows without a selection', async () => {
    mocks.getAttendance.mockResolvedValue(roster([item(1, 'Ana Pérez', 'no_show'), BO, CY]));
    renderPage();
    await screen.findByText('Yoga');

    fireEvent.click(screen.getByRole('button', { name: 'Mark all attended' }));

    expect((group('Ana Pérez').getByLabelText('No-show') as HTMLInputElement).checked).toBe(true);
    expect((group('Bo Berg').getByLabelText('Attended') as HTMLInputElement).checked).toBe(true);
    expect((group('Cy Carlsson').getByLabelText('Attended') as HTMLInputElement).checked).toBe(true);
  });

  it('Save is disabled until something changes and sends only the changed rows', async () => {
    mocks.getAttendance.mockResolvedValue(roster([item(1, 'Ana Pérez', 'attended'), BO, CY]));
    const savedRoster = roster([item(1, 'Ana Pérez', 'attended'), item(2, 'Bo Berg', 'no_show'), CY]);
    mocks.saveAttendance.mockResolvedValue(savedRoster);
    renderPage();
    await screen.findByText('Yoga');
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(group('Bo Berg').getByLabelText('No-show'));
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.saveAttendance).toHaveBeenCalledTimes(1));
    expect(mocks.saveAttendance).toHaveBeenCalledWith(CLASS_ID, [{ bookingId: BO.bookingId, attendance: 'no_show' }]);
    const toast = await screen.findByRole('status');
    expect(toast.textContent).toBe('Attendance saved.');
    expect(screen.getByText(/Booked 3 · Attended 1 · No-show 1 · Not recorded\s+1/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('shows "Saving…" and disables Save while the request runs', async () => {
    mocks.getAttendance.mockResolvedValue(roster([ANA]));
    mocks.saveAttendance.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByText('Yoga');

    fireEvent.click(group('Ana Pérez').getByLabelText('Attended'));
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton().textContent).toBe('Saving…'));
    expect(saveButton().disabled).toBe(true);
  });

  it('shows the API message and keeps the choices when saving fails', async () => {
    mocks.getAttendance.mockResolvedValue(roster([ANA]));
    mocks.saveAttendance.mockRejectedValue(
      new ApiError(409, 'ATTENDANCE_CLOSED', 'Attendance for this class can no longer be changed. Ask your club manager to correct it.'),
    );
    renderPage();
    await screen.findByText('Yoga');

    fireEvent.click(group('Ana Pérez').getByLabelText('No-show'));
    fireEvent.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Ask your club manager to correct it.');
    expect((group('Ana Pérez').getByLabelText('No-show') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the empty state without a Save button', async () => {
    mocks.getAttendance.mockResolvedValue(roster([]));
    renderPage();
    expect(await screen.findByText('No confirmed bookings for this class.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows the "not open" text and disables the controls before the class starts', async () => {
    mocks.getAttendance.mockResolvedValue(
      roster([ANA], {
        canEdit: false,
        window: { opensAt: '2026-10-30T09:00:00.000Z', closesAt: '2026-10-31T10:00:00.000Z', state: 'not_open' },
      }),
    );
    renderPage();
    expect(await screen.findByText('Attendance opens when the class starts at 10:00.')).toBeTruthy();
    expect((group('Ana Pérez').getByLabelText('Attended') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Mark all attended' }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it('is read-only for an instructor after the window closes', async () => {
    mocks.getAttendance.mockResolvedValue(
      roster([item(1, 'Ana Pérez', 'attended')], {
        canEdit: false,
        window: { opensAt: '2026-10-30T09:00:00.000Z', closesAt: '2026-10-31T10:00:00.000Z', state: 'closed' },
      }),
    );
    renderPage();
    expect(await screen.findByText('Attendance is closed. Ask your club manager to correct it.')).toBeTruthy();
    expect((group('Ana Pérez').getByLabelText('No-show') as HTMLInputElement).disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it('lets the club manager correct after the window closes', async () => {
    mocks.getAttendance.mockResolvedValue(
      roster([item(1, 'Ana Pérez', 'no_show')], {
        canEdit: true,
        window: { opensAt: '2026-10-30T09:00:00.000Z', closesAt: '2026-10-31T10:00:00.000Z', state: 'closed' },
      }),
    );
    renderPage();
    await screen.findByText('Yoga');
    expect(screen.queryByText('Attendance is closed. Ask your club manager to correct it.')).toBeNull();
    fireEvent.click(group('Ana Pérez').getByLabelText('Attended'));
    expect(saveButton().disabled).toBe(false);
  });

  it('shows the API message in an alert and reloads on Retry', async () => {
    mocks.getAttendance
      .mockRejectedValueOnce(new ApiError(409, 'CLASS_CANCELLED', 'This class has been cancelled.'))
      .mockResolvedValueOnce(roster([ANA]));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This class has been cancelled.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Yoga')).toBeTruthy();
    expect(mocks.getAttendance).toHaveBeenCalledTimes(2);
  });

  it('shows the generic message for an unexpected failure', async () => {
    mocks.getAttendance.mockRejectedValue(new Error('boom'));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("We couldn't load the attendance list. Please try again.");
  });

  it('tells the auth provider when the session is gone', async () => {
    mocks.getAttendance.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
    renderPage();
    await waitFor(() => expect(mocks.onUnauthenticated).toHaveBeenCalled());
  });
});
