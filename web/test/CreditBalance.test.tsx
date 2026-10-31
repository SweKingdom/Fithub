import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CreditBalance } from '../src/components/CreditBalance';

describe('CreditBalance', () => {
  it('AC 10: shows "Class credits: N" for a regular member', () => {
    render(<CreditBalance creditBalance={4} />);
    expect(screen.getByText('Class credits: 4')).toBeTruthy();
  });

  it('AC 10: shows 0 credits as "Class credits: 0"', () => {
    render(<CreditBalance creditBalance={0} />);
    expect(screen.getByText('Class credits: 0')).toBeTruthy();
  });

  it('AC 10: announces changes politely to screen readers', () => {
    render(<CreditBalance creditBalance={4} />);
    expect(screen.getByText('Class credits: 4').getAttribute('aria-live')).toBe('polite');
  });

  it('AC 10: renders nothing for drop-in members and staff (creditBalance null)', () => {
    const { container } = render(<CreditBalance creditBalance={null} />);
    expect(container.textContent).toBe('');
    expect(screen.queryByText(/Class credits/)).toBeNull();
  });
});
