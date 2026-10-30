import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { listClubs, type Club } from '../api/clubs';
import { getSchedule, type ScheduleItem } from '../api/classes';
import { ApiError } from '../api/client';
import { ClassCard } from '../components/ClassCard';
import { useAuth } from '../lib/auth';
import { clubDateKey, formatClubDay } from '../lib/time';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'no-clubs' }
  | { status: 'ready'; clubs: Club[]; items: ScheduleItem[] };

interface DayGroup {
  key: string;
  heading: string;
  items: ScheduleItem[];
}

/** Items arrive sorted by start time, so groups keep that order. */
function groupByClubDay(items: ScheduleItem[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const item of items) {
    const key = clubDateKey(item.startAt, item.clubTimezone);
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { key, heading: formatClubDay(item.startAt, item.clubTimezone), items: [item] });
    }
  }
  return [...groups.values()];
}

export function SchedulePage() {
  const { me, onUnauthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [flash] = useState<string | null>(
    () => (location.state as { flash?: string } | null)?.flash ?? null,
  );

  // The flash is shown once: drop it from the history entry after the first render.
  useEffect(() => {
    if (flash !== null) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for the initial flash
  }, []);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setReloadToken((token) => token + 1);
  }, []);

  const handleFailure = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      setState({ status: 'error' });
    },
    [onUnauthenticated],
  );

  // Clubs load once (and again on "Try again" when they failed).
  useEffect(() => {
    if (clubs !== null) return;
    let active = true;
    listClubs()
      .then((list) => {
        if (!active) return;
        setClubs(list);
        if (list.length === 0) setState({ status: 'no-clubs' });
      })
      .catch((error: unknown) => {
        if (active) handleFailure(error);
      });
    return () => {
      active = false;
    };
  }, [clubs, handleFailure, reloadToken]);

  // ?clubId (if known) → the user's home club → the first club by name.
  const clubId = useMemo(() => {
    if (clubs === null || clubs.length === 0) return null;
    const known = (id: string | null | undefined) => clubs.find((club) => club.id === id)?.id;
    return known(searchParams.get('clubId')) ?? known(me?.clubId) ?? clubs[0].id;
  }, [clubs, searchParams, me?.clubId]);

  useEffect(() => {
    if (clubs === null || clubId === null) return;
    let active = true;
    setState({ status: 'loading' });
    getSchedule({ clubId })
      .then((response) => {
        if (active) setState({ status: 'ready', clubs, items: response.items });
      })
      .catch((error: unknown) => {
        if (active) handleFailure(error);
      });
    return () => {
      active = false;
    };
  }, [clubs, clubId, reloadToken, handleFailure]);

  function changeClub(id: string): void {
    navigate(`/schedule?clubId=${encodeURIComponent(id)}`, { replace: true });
  }

  const groups = state.status === 'ready' ? groupByClubDay(state.items) : [];

  return (
    <main>
      <h1>Schedule</h1>
      {flash !== null && <p role="status">{flash}</p>}

      <label htmlFor="club-select">Club</label>
      <select
        id="club-select"
        value={clubId ?? ''}
        disabled={clubs === null || clubs.length === 0}
        onChange={(event) => changeClub(event.target.value)}
      >
        {(clubs ?? []).map((club) => (
          <option key={club.id} value={club.id}>
            {club.name}
          </option>
        ))}
      </select>

      <div aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <p>Loading schedule…</p>}

        {state.status === 'no-clubs' && <p>There are no clubs to show a schedule for yet.</p>}

        {state.status === 'error' && (
          <div role="alert">
            <p>We couldn't load the schedule. Please try again.</p>
            <button type="button" onClick={reload}>
              Try again
            </button>
          </div>
        )}

        {state.status === 'ready' && state.items.length === 0 && (
          <p>No classes scheduled in the next two weeks.</p>
        )}

        {groups.map((group) => (
          <section key={group.key}>
            <h2>{group.heading}</h2>
            <ul>
              {group.items.map((item) => (
                <ClassCard key={item.id} item={item} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
