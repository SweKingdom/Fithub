import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScheduleItem } from '../src/api/classes';
import { ClassCard } from '../src/components/ClassCard';

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    clubId: '22222222-2222-4222-8222-222222222222',
    clubName: 'FitHub City',
    clubTimezone: 'Europe/Stockholm',
    name: 'Spinning 45',
    startAt: '2026-11-02T17:00:00.000Z',
    durationMinutes: 45,
    capacity: 20,
    freePlaces: 2,
    status: 'scheduled',
    instructorName: 'Anna Berg',
    myBookingStatus: 'none',
    myBooking: null,
    myWaitlist: null,
    ...overrides,
  };
}

const action = <button type="button">Do it</button>;

describe('ClassCard', () => {
  it('shows time range in club time, name, instructor and places', () => {
    render(<ul><ClassCard item={item()} /></ul>);
    expect(screen.getByText('18:00–18:45')).toBeTruthy();
    expect(screen.getByText('Spinning 45')).toBeTruthy();
    expect(screen.getByText('with Anna Berg')).toBeTruthy();
    expect(screen.getByText('2 of 20 places left')).toBeTruthy();
  });

  it('omits the instructor when there is none', () => {
    render(<ul><ClassCard item={item({ instructorName: null })} /></ul>);
    expect(screen.queryByText(/^with /)).toBeNull();
  });

  it('AC 3: a full class shows "Full – join waiting list" and no Book button', () => {
    render(<ul><ClassCard item={item({ freePlaces: 0 })} /></ul>);
    expect(screen.getByText('Full – join waiting list')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /book/i })).toBeNull();
  });

  it('AC 4: own booking states', () => {
    const { rerender } = render(
      <ul><ClassCard item={item({ myBookingStatus: 'confirmed', myBooking: { id: 'b', status: 'confirmed' } })} /></ul>,
    );
    expect(screen.getByText('Booked')).toBeTruthy();
    rerender(
      <ul>
        <ClassCard item={item({ myBookingStatus: 'pending_payment', myBooking: { id: 'b', status: 'pending_payment' } })} />
      </ul>,
    );
    expect(screen.getByText('Payment pending')).toBeTruthy();
    rerender(<ul><ClassCard item={item({ myBookingStatus: 'waiting' })} /></ul>);
    expect(screen.getByText('On waiting list')).toBeTruthy();
  });

  it('shows no badge when places are left and nothing is booked', () => {
    const { container } = render(<ul><ClassCard item={item()} /></ul>);
    expect(container.querySelector('.class-card__badge')).toBeNull();
  });

  it('AC 7: a cancelled class shows "Cancelled", no places text and no action', () => {
    render(
      <ul>
        <ClassCard item={item({ status: 'cancelled', myBookingStatus: 'confirmed' })} action={action} />
      </ul>,
    );
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText('Booked')).toBeNull();
    expect(screen.queryByText(/places left/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the action slot for scheduled classes', () => {
    render(<ul><ClassCard item={item()} action={action} /></ul>);
    expect(screen.getByRole('button', { name: 'Do it' })).toBeTruthy();
  });
});
