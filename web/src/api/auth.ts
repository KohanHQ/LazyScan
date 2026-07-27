import { apiRequest } from "@/api/client";

export type UserRole = "user" | "superuser";

export type AuthUser = {
  id: string;
  email: string;
};

export type CurrentUser = AuthUser & {
  // `id` is the public display id (text); `userId` is the account UUID, which is
  // what manga.createdByUserId is compared against for ownership gating.
  userId: string;
  role: UserRole;
  createdAt: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type AuthCredentials = {
  email: string;
  password: string;
};

// Register sets no session cookie (hard verify): the account stays
// unverified until the emailed code is confirmed via verifyEmail.
export type RegisterResult = {
  email: string;
  verificationRequired: boolean;
};

export type VerifyEmailInput = {
  email: string;
  code: string;
};

export type ResetPasswordInput = {
  email: string;
  code: string;
  newPassword: string;
};

export function getCurrentUser(): Promise<CurrentUser> {
  return apiRequest<CurrentUser>("/auth/me");
}

export function login(credentials: AuthCredentials): Promise<AuthUser> {
  return apiRequest<AuthUser>("/auth/login", {
    method: "POST",
    body: credentials,
  });
}

export function register(credentials: AuthCredentials): Promise<RegisterResult> {
  return apiRequest<RegisterResult>("/auth/register", {
    method: "POST",
    body: credentials,
  });
}

// Success consumes the code and sets the session cookie (auto-login).
export function verifyEmail(input: VerifyEmailInput): Promise<AuthUser> {
  return apiRequest<AuthUser>("/auth/verify-email", {
    method: "POST",
    body: input,
  });
}

// Always resolves `{ ok: true }` regardless of account state (no
// enumeration); the server enforces a 60s cooldown between sends.
export function resendVerification(email: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>("/auth/resend-verification", {
    method: "POST",
    body: { email },
  });
}

// Always resolves `{ ok: true }` regardless of account state (no
// enumeration); the server enforces a 15min cooldown between sends.
export function forgotPassword(email: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>("/auth/forgot-password", {
    method: "POST",
    body: { email },
  });
}

// Sets no session cookie: the user logs in again with the new password.
export function resetPassword(input: ResetPasswordInput): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>("/auth/reset-password", {
    method: "POST",
    body: input,
  });
}

export function logout(): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>("/auth/logout", {
    method: "POST",
  });
}
