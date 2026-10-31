import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import type { Payment } from '../src/api/payments';
import { PayBookingPage } from '../src/pages/PayBookingPage';

const mocks = vi.hoisted(() => ({
  getPayment: vi.fn(),
  resumePayment: vi.fn(),
  confirmPayment: vi.fn(),
  loadStripe: vi.fn(),
  onUnauthenticated: vi.fn(),
}));

vi.mock('../src/api/payments', () => ({ getPayment: mocks.getPayment, resumePayment: mocks.resumePayment }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ onUnauthenticated: mocks.onUnauthenticated }) }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: mocks.loadStripe }));
vi.mock('@stripe/react-stripe-js', async () => {
  const { createElement } = await import('react');
  return {
    Elements: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
    PaymentElement: () => createElement('div', { 'data-testid': 'payment-element' }),
    useStripe: () => ({ confirmPayment: mocks.confirmPayment }),
    useElements: () => ({}),
  };
});

const OPEN: Payment = {
  status: 'requires_payment',
  amount: 1500,
  currency: 'eur',
  clientSecret: 'cs_test_1',
  publishableKey: 'pk_test_1',
  holdExpiresAt: '2026-11-03T10:00:00.000Z',
  nextRetryAt: null,
  message: null,
};
const STATUS_ONLY = (status: Payment['status'], message: string | null = null): Payment => ({
  ...OPEN,
  status,
  clientSecret: null,
  publishableKey: null,
  message,
});

const DECLINED = 'Your payment was declined. Your booking was not confirmed.';
const GENERIC = 'Something went wrong. Please try again.';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/bookings/b1/pay']}>
      <Routes>
        <Route path="/bookings/:bookingId/pay" element={<PayBookingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const payButton = () => screen.getByRole('button', { name: /^(Pay|Processing)/ }) as HTMLButtonElement;

/** Lets the fake clock run `ms` forward and the promises that the polling started settle. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Opens the pay page in the ready state and presses the pay button. */
async function openAndPay() {
  renderPage();
  await screen.findByTestId('payment-element');
  await act(async () => {
    fireEvent.click(payButton());
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.loadStripe.mockResolvedValue({});
  mocks.resumePayment.mockResolvedValue(OPEN);
  mocks.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'processing' } });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PayBookingPage (US-132 AC 11)', () => {
  it('loading → ready: shows the amount, the Payment Element and an enabled pay button', async () => {
    renderPage();
    expect(screen.getByText('Loading payment…')).toBeTruthy();

    expect(await screen.findByTestId('payment-element')).toBeTruthy();
    expect(screen.getByText(/15[.,]00/, { selector: 'strong' })).toBeTruthy();
    expect(payButton().disabled).toBe(false);
    expect(payButton().textContent).toMatch(/^Pay .*15[.,]00/);
    expect(mocks.resumePayment).toHaveBeenCalledWith('b1');
    expect(mocks.loadStripe).toHaveBeenCalledWith('pk_test_1');
  });

  it('shows zero-decimal currencies without dividing by 100', async () => {
    mocks.resumePayment.mockResolvedValue({ ...OPEN, amount: 1500, currency: 'jpy' });
    renderPage();
    await screen.findByTestId('payment-element');
    expect(screen.getByText(/1,?500/, { selector: 'strong' })).toBeTruthy();
  });

  it('processing → succeeded: confirms with redirect if_required, locks the button, polls until the booking is confirmed', async () => {
    mocks.getPayment.mockResolvedValueOnce(STATUS_ONLY('requires_payment')).mockResolvedValue(STATUS_ONLY('succeeded'));
    await openAndPay();

    expect(mocks.confirmPayment).toHaveBeenCalledWith(expect.objectContaining({ redirect: 'if_required' }));
    expect(payButton().disabled).toBe(true);
    expect(payButton().textContent).toBe('Processing payment…');
    expect(mocks.getPayment).not.toHaveBeenCalled();

    await wait(2000);
    expect(mocks.getPayment).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Payment received – you're booked.")).toBeNull();

    await wait(2000);
    expect(screen.getByText("Payment received – you're booked.")).toBeTruthy();
    expect(screen.queryByTestId('payment-element')).toBeNull();
    expect(mocks.getPayment).toHaveBeenCalledWith('b1');
  });

  it('processing → declined: the webhook cancelled the booking', async () => {
    mocks.getPayment.mockResolvedValue(STATUS_ONLY('failed', DECLINED));
    await openAndPay();
    await wait(2000);
    expect(screen.getByRole('alert').textContent).toBe(DECLINED);
  });

  it('a card error shows Stripe’s message, then the declined message once the booking is cancelled', async () => {
    mocks.confirmPayment.mockResolvedValue({ error: { type: 'card_error', message: 'Your card has insufficient funds.' } });
    mocks.getPayment.mockResolvedValue(STATUS_ONLY('failed', DECLINED));
    await openAndPay();
    expect(screen.getByRole('alert').textContent).toBe('Your card has insufficient funds.');
    expect(payButton().disabled).toBe(true);

    await wait(2000);
    expect(screen.getByRole('alert').textContent).toBe(DECLINED);
  });

  it('a validation error leaves the form open and does not start polling', async () => {
    mocks.confirmPayment.mockResolvedValue({ error: { type: 'validation_error', message: 'Incomplete card number.' } });
    await openAndPay();

    expect(payButton().disabled).toBe(false);
    expect(payButton().textContent).toMatch(/^Pay /);
    await wait(6000);
    expect(mocks.getPayment).not.toHaveBeenCalled();
  });

  it('stops polling after 30 seconds and shows the error message', async () => {
    mocks.getPayment.mockResolvedValue(STATUS_ONLY('requires_payment'));
    await openAndPay();
    for (let i = 0; i < 15; i++) await wait(2000);

    expect(mocks.getPayment).toHaveBeenCalledTimes(15);
    expect(screen.getByRole('alert').textContent).toBe(GENERIC);
    await wait(10000);
    expect(mocks.getPayment).toHaveBeenCalledTimes(15);
  });

  it('keeps polling when one poll fails', async () => {
    mocks.getPayment
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValue(STATUS_ONLY('succeeded'));
    await openAndPay();
    await wait(2000);
    expect(screen.queryByText("Payment received – you're booked.")).toBeNull();
    await wait(2000);
    expect(screen.getByText("Payment received – you're booked.")).toBeTruthy();
  });

  it('on hold: shows the API message while Stripe could not be reached, with no card form', async () => {
    const hold = "We couldn't reach our payment provider. Your booking is on hold and we'll retry automatically – you don't need to book again.";
    mocks.resumePayment.mockResolvedValue(STATUS_ONLY('pending_retry', hold));
    renderPage();
    expect((await screen.findByRole('status')).textContent).toBe(hold);
    expect(screen.queryByTestId('payment-element')).toBeNull();
  });

  it('expired: shows that the booking was cancelled because the payment was not completed in time', async () => {
    const expired = 'Your booking was cancelled because the payment was not completed in time.';
    mocks.resumePayment.mockResolvedValue(STATUS_ONLY('expired', expired));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe(expired);
  });

  it('an already paid booking opened again shows the success message', async () => {
    mocks.resumePayment.mockResolvedValue(STATUS_ONLY('succeeded'));
    renderPage();
    expect(await screen.findByText("Payment received – you're booked.")).toBeTruthy();
  });

  it('error: an unexpected failure shows the generic message and "Try again" loads the page again', async () => {
    mocks.resumePayment.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'boom'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain(GENERIC);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('payment-element')).toBeTruthy();
    expect(mocks.resumePayment).toHaveBeenCalledTimes(2);
  });

  it('error: a booking that cannot be paid shows the API message', async () => {
    const message = "This booking has been cancelled, so it can't be paid. Please book the class again.";
    mocks.resumePayment.mockRejectedValue(new ApiError(409, 'BOOKING_NOT_PAYABLE', message));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain(message);
  });

  it('signs the user out locally when the API answers 401', async () => {
    mocks.resumePayment.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.'));
    renderPage();
    await screen.findByText('Loading payment…');
    await wait(100);
    expect(mocks.onUnauthenticated).toHaveBeenCalled();
  });
});
