/**
 * Payment gateway port (US-132, ADR-022). The service layer talks to this interface only;
 * `stripe-gateway.ts` is the Stripe implementation, tests use a scripted fake.
 */

export type GatewayErrorKind = 'unavailable' | 'declined' | 'rejected';

/**
 * A failed gateway call, classified for the caller:
 * - `unavailable`: Stripe could not be reached or failed (connection, timeout, 5xx, 429) → retry later;
 * - `declined`: the card was refused → final;
 * - `rejected`: the request was refused (invalid request, auth, permission, idempotency) → misconfiguration.
 * The message holds the kind and the Stripe code only, so it is safe to store in `payment.last_error`.
 */
export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;
  readonly code: string;
  readonly httpStatus: number | undefined;

  constructor(kind: GatewayErrorKind, code: string, httpStatus?: number) {
    super(`${kind}:${code}`);
    this.name = 'GatewayError';
    this.kind = kind;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** The webhook signature is missing, malformed, expired or does not match the body. */
export class InvalidSignatureError extends Error {
  constructor() {
    super('Invalid webhook signature');
    this.name = 'InvalidSignatureError';
  }
}

export interface CreateIntentInput {
  /** Minor units. */
  amount: number;
  /** Lower-case ISO 4217 code. */
  currency: string;
  /** `booking-{bookingId}`: Stripe returns the same intent for a repeated key. */
  idempotencyKey: string;
  metadata: { bookingId: string; memberId: string; paymentId: string };
}

export interface PaymentIntentInfo {
  id: string;
  /** Never stored and never logged. */
  clientSecret: string;
  status: string;
}

/** A verified webhook event, reduced to what FitHub reads. */
export interface WebhookEvent {
  id: string;
  type: string;
  /** `data.object.id`; for payment intent events this is the PaymentIntent id. */
  objectId: string | null;
  /** `data.object.amount_received` when the object has one. */
  amountReceived: number | null;
  /** String entries of `data.object.metadata`. */
  metadata: Record<string, string>;
}

export interface PaymentGateway {
  /** Creates a card PaymentIntent. Throws `GatewayError`. */
  createIntent(input: CreateIntentInput): Promise<PaymentIntentInfo>;
  /** Retrieves an existing PaymentIntent (resume payment). Throws `GatewayError`. */
  retrieveIntent(intentId: string): Promise<PaymentIntentInfo>;
  /** Verifies the signature over the raw body. Throws `InvalidSignatureError`. */
  constructEvent(rawBody: Buffer, signatureHeader: string | undefined): WebhookEvent;
}
