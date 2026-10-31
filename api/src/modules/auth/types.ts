export type Role = 'member' | 'instructor' | 'club_manager';
export type MemberType = 'regular' | 'drop_in';

/** The signed-in caller. The only trusted source of the caller's id, role and club (ADR-015). */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  memberType: MemberType | null;
  clubId: string | null;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyContextConfig {
    /** Route opts out of the global sign-in requirement. Only sign-in and sign-out use it. */
    public?: boolean;
  }
}
