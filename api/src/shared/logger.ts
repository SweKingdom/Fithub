/** The part of the Fastify (pino) logger that background code uses. Structured fields first, then the message. */
export interface Logger {
  info(fields: object, message?: string): void;
  warn(fields: object, message?: string): void;
  error(fields: object, message?: string): void;
}
