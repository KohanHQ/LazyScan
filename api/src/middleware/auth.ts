import { Elysia } from "elysia";
import { verifySessionToken } from "@/shared/crypto/jwt";
import { isSessionRevoked } from "@/shared/auth/denylist";
import { unauthorized } from "@/shared/http/error";
import { findById } from "@/modules/auth/auth.repository";
import type { UUID } from "@/shared/types/id";
import type { UserRole } from "@/modules/auth/auth.model";

export interface AuthUser {
  id: UUID;
  email: string;
  role: UserRole;
}

export interface AuthContext {
  user: AuthUser;
}

async function resolveUser(
  sessionCookie: string | undefined
): Promise<AuthUser | null> {
  if (!sessionCookie) return null;

  try {
    const { userId, jti } = await verifySessionToken(sessionCookie);
    // Per-token revocation: a logged-out (denylisted) session is rejected even
    // though its JWT is still cryptographically valid and unexpired. One Redis
    // read per authenticated request; fail-open if Redis is down.
    if (jti && (await isSessionRevoked(jti))) {
      return null;
    }
    const user = await findById(userId);
    if (!user) return null;

    return { id: user.id, email: user.email, role: user.role };
  } catch {
    return null;
  }
}

export async function resolveRequiredUser(
  sessionCookie: string | undefined
): Promise<AuthUser> {
  const user = await resolveUser(sessionCookie);
  if (!user) {
    throw unauthorized("Authentication required");
  }
  return user;
}

export const authMiddleware = new Elysia({ name: "auth" }).derive(
  async ({ cookie: { session } }) => {
    const sessionValue = session?.value as string | undefined;
    const user = await resolveUser(sessionValue);
    return { user };
  }
);

export const requireAuth = new Elysia({ name: "requireAuth" }).resolve(
  async ({ cookie: { session } }) => {
    const sessionValue = session?.value as string | undefined;
    const user = await resolveRequiredUser(sessionValue);
    return { user };
  }
);
