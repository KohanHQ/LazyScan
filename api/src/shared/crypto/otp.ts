import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

// 6-digit numeric one-time code for email verification (Herald pipeline).
// The brute-force control is the verify attempt cap
// (staticConfig.emailVerification), not hash work factor, so
// salted SHA-256 at rest is deliberate: verify stays cheap and no second
// bcrypt round lands on the auth hot path. Plaintext codes exist only in the
// outbox payload on their way to Herald — never log them.
export const OTP_CODE_LENGTH = 6;

export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(
    OTP_CODE_LENGTH,
    "0",
  );
}

export function generateOtpSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashOtpCode(code: string, salt: string): string {
  return createHash("sha256").update(`${code}${salt}`).digest("hex");
}

// Constant-time comparison; both sides are fixed-length SHA-256 hex.
export function verifyOtpCode(
  code: string,
  salt: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashOtpCode(code, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
