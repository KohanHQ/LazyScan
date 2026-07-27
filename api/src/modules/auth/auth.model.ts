import { UUID, DisplayID } from "@/shared/types/id";

export type UserRole = "user" | "superuser";

export interface User {
  id: UUID;
  displayId: DisplayID;
  email: string;
  role: UserRole;
  passwordHash: string;
  verified: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Which flow an email_verifications row belongs to. Rows are looked up per
// purpose, so a reset code never shadows a pending registration code.
export type OtpPurpose = "verify" | "password_reset";

// One row in email_verifications: the active OTP for a user. The code is
// hashed at rest (sha256(code + salt)); resend rotates the same row.
export interface EmailVerification {
  id: UUID;
  userId: UUID;
  codeHash: string;
  salt: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface AuthSession {
  userId: UUID;
  issuedAt: Date;
  expiresAt: Date;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface VerifyEmailRequest {
  email: string;
  code: string;
}

export interface ResendVerificationRequest {
  email: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}
