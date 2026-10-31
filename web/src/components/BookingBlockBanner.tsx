import type { BookingBlock } from '../api/auth';

/** Id for `aria-describedby` on the Book and Join waiting list buttons while the member is blocked. */
export const BOOKING_BLOCK_BANNER_ID = 'booking-block-banner';

interface BookingBlockBannerProps {
  /** `me.bookingBlock`; nothing is rendered when it is null. */
  block: BookingBlock | null;
}

/** Tells a blocked member why they cannot book and until when (US-130). The text comes from the API. */
export function BookingBlockBanner({ block }: BookingBlockBannerProps) {
  if (block === null) return null;
  return (
    <p id={BOOKING_BLOCK_BANNER_ID} role="status" className="booking-block-banner">
      {block.message}
    </p>
  );
}
