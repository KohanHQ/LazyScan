import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { UUID } from "@/shared/types/id";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "default_secret_key_for_dev",
);

export function signSessionToken(
  payload: { userId: UUID },
  options: { expiresIn?: string } = {},
) {
  // Each session carries a unique jti so it can be individually revoked
  // (server-side denylist on logout). See shared/auth/denylist.ts.
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "7d")
    .sign(secret);
}

// Returns the claims the auth layer needs. `jti`/`exp` are optional because
// tokens minted before the jti rollout lack them (they stay valid until natural
// expiry and simply can't be individually revoked). `exp` is the standard JWT
// seconds-since-epoch expiry.
export async function verifySessionToken(
  token: string,
): Promise<{ userId: UUID; jti?: string; exp?: number }> {
  const { payload } = await jwtVerify(token, secret);
  return {
    userId: payload.userId as UUID,
    jti: payload.jti,
    exp: payload.exp,
  };
}
