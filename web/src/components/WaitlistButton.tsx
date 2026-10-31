import { useState } from 'react';
import { ApiError } from '../api/client';
import { joinWaitlist, leaveWaitlist } from '../api/waitlist';
import { ConfirmDialog } from './ConfirmDialog';

export interface WaitlistButtonProps {
  classId: string;
  className: string;
  /** Start date and time already formatted in club time (`formatClubTime`). */
  dateLabel: string;
  timeLabel: string;
  /** The viewer's own entry from the schedule item; `null` when not on the list. */
  myWaitlist: { entryId: string; position: number } | null;
  /** Set by US-130 while the member is blocked: Join is disabled and points at the block banner. */
  blockedDescribedBy?: string;
  /** Success text for the parent's toast (`role="status"`). */
  onNotify: (message: string) => void;
  /** Error text for the parent's banner (`role="alert"`). */
  onError: (message: string) => void;
  /** Called after every attempt so the parent refetches the schedule. */
  onChanged: () => void;
}

const GENERIC_ERROR = 'Something went wrong. Please try again.';

function errorMessage(error: unknown): string {
  return error instanceof ApiError && error.status < 500 ? error.message : GENERIC_ERROR;
}

/** Join / "Waiting list – position N" + Leave (US-127). Rendered by `BookButton` for members. */
export function WaitlistButton(props: WaitlistButtonProps) {
  const { classId, className, dateLabel, timeLabel, myWaitlist, blockedDescribedBy } = props;
  const [dialog, setDialog] = useState<'join' | 'leave' | null>(null);
  const [busy, setBusy] = useState<'joining' | 'leaving' | null>(null);

  async function confirmJoin(): Promise<void> {
    setDialog(null);
    setBusy('joining');
    try {
      const entry = await joinWaitlist(classId);
      props.onNotify(`You're on the waiting list – position ${entry.position ?? 1}.`);
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(null);
      props.onChanged();
    }
  }

  async function confirmLeave(): Promise<void> {
    if (!myWaitlist) return;
    setDialog(null);
    setBusy('leaving');
    try {
      await leaveWaitlist(myWaitlist.entryId);
      props.onNotify("You've left the waiting list.");
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(null);
      props.onChanged();
    }
  }

  return (
    <>
      {myWaitlist ? (
        <>
          <span>Waiting list – position {myWaitlist.position}</span>
          <button type="button" disabled={busy !== null} onClick={() => setDialog('leave')}>
            {busy === 'leaving' ? 'Leaving…' : 'Leave waiting list'}
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy !== null || blockedDescribedBy !== undefined}
          aria-describedby={blockedDescribedBy}
          onClick={() => setDialog('join')}
        >
          {busy === 'joining' ? 'Joining…' : 'Join waiting list'}
        </button>
      )}

      {dialog === 'join' && (
        <ConfirmDialog
          message={`Join the waiting list for ${className} on ${dateLabel} at ${timeLabel}? If a place frees up, it is booked for you automatically.`}
          confirmLabel="Join"
          cancelLabel="Not now"
          onConfirm={() => void confirmJoin()}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'leave' && (
        <ConfirmDialog
          message={`Leave the waiting list for ${className}?`}
          confirmLabel="Leave"
          cancelLabel="Stay"
          onConfirm={() => void confirmLeave()}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
}
