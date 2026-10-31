interface CreditBalanceProps {
  /** `me.creditBalance`: a number for regular members, `null` for drop-in members and staff. */
  creditBalance: number | null;
}

/** Navigation badge with the member's class credits. Rendered for regular members only. */
export function CreditBalance({ creditBalance }: CreditBalanceProps) {
  if (creditBalance === null) return null;
  return (
    <span className="credit-balance" aria-live="polite">
      Class credits: {creditBalance}
    </span>
  );
}
