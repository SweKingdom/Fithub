import type { ReactNode } from 'react';
import type { ScheduleItem } from '../api/classes';
import { formatClubTime } from '../lib/time';

/** Status text for the card; first match wins. Text, not colour only. */
export function cardBadge(item: ScheduleItem): string | null {
  if (item.status === 'cancelled') return 'Cancelled';
  if (item.myBookingStatus === 'confirmed') return 'Booked';
  if (item.myBookingStatus === 'pending_payment') return 'Payment pending';
  if (item.myBookingStatus === 'waiting') return 'On waiting list';
  if (item.freePlaces === 0) return 'Full – join waiting list';
  return null;
}

interface ClassCardProps {
  item: ScheduleItem;
  /** Rendered only for scheduled classes (booking, waiting list and cancel buttons plug in here). */
  action?: ReactNode;
}

export function ClassCard({ item, action }: ClassCardProps) {
  const endIso = new Date(Date.parse(item.startAt) + item.durationMinutes * 60_000).toISOString();
  const badge = cardBadge(item);
  const cancelled = item.status === 'cancelled';

  return (
    <li className="class-card">
      <p className="class-card__time">
        {formatClubTime(item.startAt, item.clubTimezone)}–{formatClubTime(endIso, item.clubTimezone)}
      </p>
      <h3 className="class-card__name">{item.name}</h3>
      {item.instructorName !== null && <p>with {item.instructorName}</p>}
      {!cancelled && (
        <p>
          {item.freePlaces} of {item.capacity} places left
        </p>
      )}
      {badge !== null && <span className="class-card__badge">{badge}</span>}
      {!cancelled && action}
    </li>
  );
}
