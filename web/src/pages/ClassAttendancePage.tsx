import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getAttendance,
  saveAttendance,
  type AttendanceEntry,
  type AttendanceRoster,
  type AttendanceValue,
} from '../api/attendance';
import { ApiError } from '../api/client';
import { useAuth } from '../lib/auth';
import { formatClubDay, formatClubTime } from '../lib/time';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; roster: AttendanceRoster };

type Choices = Record<string, AttendanceValue>;

const LOAD_ERROR = "We couldn't load the attendance list. Please try again.";
const SAVE_ERROR = "We couldn't save the attendance. Please try again.";

function choicesOf(roster: AttendanceRoster): Choices {
  return Object.fromEntries(roster.items.map((item) => [item.bookingId, item.attendance]));
}

export function ClassAttendancePage() {
  const { classId = '' } = useParams();
  const { onUnauthenticated } = useAuth();

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [choices, setChoices] = useState<Choices>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const showRoster = useCallback((roster: AttendanceRoster) => {
    setState({ status: 'ready', roster });
    setChoices(choicesOf(roster));
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    getAttendance(classId)
      .then((roster) => {
        if (active) showRoster(roster);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthenticated();
          return;
        }
        setState({ status: 'error', message: error instanceof ApiError ? error.message : LOAD_ERROR });
      });
    return () => {
      active = false;
    };
  }, [classId, reloadToken, showRoster, onUnauthenticated]);

  function retry(): void {
    setSaved(false);
    setSaveError(null);
    setReloadToken((token) => token + 1);
  }

  if (state.status === 'loading') {
    return (
      <main aria-busy="true">
        <h1>Attendance</h1>
        <p>Loading attendance…</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main>
        <h1>Attendance</h1>
        <div role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const { roster } = state;
  const editable = roster.canEdit;
  const changed: AttendanceEntry[] = roster.items.flatMap((item) => {
    const choice = choices[item.bookingId];
    return choice !== undefined && choice !== 'unknown' && choice !== item.attendance
      ? [{ bookingId: item.bookingId, attendance: choice }]
      : [];
  });

  function choose(bookingId: string, value: AttendanceValue): void {
    setSaved(false);
    setChoices((current) => ({ ...current, [bookingId]: value }));
  }

  function markAllAttended(): void {
    setSaved(false);
    setChoices((current) =>
      Object.fromEntries(
        roster.items.map((item) => {
          const choice = current[item.bookingId] ?? item.attendance;
          return [item.bookingId, choice === 'unknown' ? 'attended' : choice];
        }),
      ),
    );
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      showRoster(await saveAttendance(classId, changed));
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      setSaveError(error instanceof ApiError ? error.message : SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  const timezone = roster.clubTimezone;
  const { summary } = roster;

  return (
    <main>
      <h1>Attendance</h1>
      <h2>{roster.className}</h2>
      <p>
        {formatClubDay(roster.startAt, timezone)}, {formatClubTime(roster.startAt, timezone)}–
        {formatClubTime(roster.endsAt, timezone)}
      </p>
      <p>
        Booked {summary.booked} · Attended {summary.attended} · No-show {summary.noShows} · Not recorded{' '}
        {summary.unknown}
      </p>

      {saved && <p role="status">Attendance saved.</p>}
      {saveError !== null && <p role="alert">{saveError}</p>}

      {roster.window.state === 'not_open' && (
        <p>Attendance opens when the class starts at {formatClubTime(roster.startAt, timezone)}.</p>
      )}
      {roster.window.state === 'closed' && !editable && (
        <p>Attendance is closed. Ask your club manager to correct it.</p>
      )}

      {roster.items.length === 0 ? (
        <p>No confirmed bookings for this class.</p>
      ) : (
        <>
          <button type="button" disabled={!editable || saving} onClick={markAllAttended}>
            Mark all attended
          </button>
          <ul>
            {roster.items.map((item) => (
              <li key={item.bookingId}>
                <div role="radiogroup" aria-label={item.memberName}>
                  <span>{item.memberName}</span>
                  {(
                    [
                      ['attended', 'Attended'],
                      ['no_show', 'No-show'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name={`attendance-${item.bookingId}`}
                        value={value}
                        checked={choices[item.bookingId] === value}
                        disabled={!editable || saving}
                        onChange={() => choose(item.bookingId, value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {item.recordedByName !== null && <small>Recorded by {item.recordedByName}</small>}
              </li>
            ))}
          </ul>
          <button type="button" disabled={!editable || saving || changed.length === 0} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </main>
  );
}
