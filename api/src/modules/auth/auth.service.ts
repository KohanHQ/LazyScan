import * as authRepo from "@/modules/auth/auth.repository";
import * as profileRepo from "@/modules/profile/profile.repository";
import {
  RegisterRequest,
  LoginRequest,
  VerifyEmailRequest,
  ResendVerificationRequest,
  User,
} from "@/modules/auth/auth.model";
import { hashPassword, verifyPassword } from "@/shared/crypto/password";
import { signSessionToken, verifySessionToken } from "@/shared/crypto/jwt";
import {
  generateOtpCode,
  generateOtpSalt,
  hashOtpCode,
  verifyOtpCode,
} from "@/shared/crypto/otp";
import {
  conflict,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  AppError,
} from "@/shared/http/error";
import { idGenerators } from "@/shared/identity/generator";
import { withTransaction } from "@/shared/database/transaction";
import type { TransactionClient } from "@/shared/database/transaction";
import {
  insertOutboxEvents,
  AUTH_EMAIL_VERIFICATION_REQUESTED,
  AUTH_EMAIL_EVENT_SCHEMA_VERSION,
} from "@/shared/outbox/outbox";
import { staticConfig } from "@/config";
import type { DisplayID } from "@/shared/types/id";
import { logInfo, logWarn } from "@/shared/utility/logger";

// A constant bcrypt hash used only to spend the same time verifying a password
// when the email does not exist, so login response time cannot reveal whether an
// account exists (mitigates user enumeration).
const DUMMY_PASSWORD_HASH =
  "$2b$12$wWmG6fZC/12Wsj0/bttQveMceIASTTI8gnPkC3U8aXQI4vivN5CVK";

// Wrong/expired/missing codes all collapse into this one error so the verify
// endpoint cannot be used to probe which emails have pending registrations.
function invalidCode(): AppError {
  return badRequest("Invalid or expired verification code", {
    code: "INVALID_CODE",
  });
}

function tooManyAttempts(): AppError {
  return new AppError({
    code: "TOO_MANY_ATTEMPTS",
    message: "Too many verification attempts, request a new code",
    status: 429,
  });
}

function shouldBeSuperuser(email: string, superuserEmails: string[] = []): boolean {
  return superuserEmails.includes(email.toLowerCase());
}

async function promoteConfiguredSuperuser(
  user: User,
  superuserEmails: string[] = []
): Promise<User> {
  if (user.role === "superuser" || !shouldBeSuperuser(user.email, superuserEmails)) {
    return user;
  }

  const promoted = await authRepo.updateRoleById(user.id, "superuser");
  return promoted ?? user;
}

// Issue (or rotate) the user's active OTP and write the mail outbox event in
// the SAME transaction as the row change — the transactional-outbox guarantee.
// Returns false when the resend cooldown swallowed the request (callers stay
// silent about it: uniform responses, no enumeration or spam lever).
// The plaintext code exists only in the outbox payload. Never log it.
async function issueVerification(
  user: User,
  tx: TransactionClient
): Promise<boolean> {
  const { codeTtlMs, resendCooldownMs } = staticConfig.emailVerification;

  const active = await authRepo.findActiveVerificationByUserId(user.id, tx);
  if (active && Date.now() - active.createdAt.getTime() < resendCooldownMs) {
    return false;
  }

  const code = generateOtpCode();
  const salt = generateOtpSalt();
  const codeHash = hashOtpCode(code, salt);
  const expiresAt = new Date(Date.now() + codeTtlMs);

  if (active) {
    await authRepo.rotateVerification(active.id, { codeHash, salt, expiresAt }, tx);
  } else {
    await authRepo.insertVerification(
      { userId: user.id, codeHash, salt, expiresAt },
      tx
    );
  }

  await insertOutboxEvents(
    [
      {
        eventType: AUTH_EMAIL_VERIFICATION_REQUESTED,
        schemaVersion: AUTH_EMAIL_EVENT_SCHEMA_VERSION,
        aggregateType: "user",
        aggregateId: user.id,
        payload: {
          userId: user.id,
          email: user.email,
          code,
          expiresAt: expiresAt.toISOString(),
        },
      },
    ],
    tx
  );

  return true;
}

// Hard verify: registration never issues a session. The user lands
// unverified with a pending OTP; the session is minted by verifyEmail.
export async function register(
  input: RegisterRequest,
  options: { superuserEmails?: string[] } = {}
): Promise<{ user: User }> {
  const existingUser = await authRepo.findByEmail(input.email);

  if (existingUser && existingUser.verified) {
    logWarn("Registration failed: email exists", { email: input.email });
    throw conflict("Email already in use", {
      code: "EMAIL_ALREADY_EXISTS",
      details: { email: input.email },
    });
  }

  const hashedPassword = await hashPassword(input.password);

  if (existingUser) {
    // Unverified re-register: ownership of the email is unproven, so the last
    // registrant's password wins and the OTP rotates (cooldown permitting).
    // Keeping the original password would let an attacker pre-register a
    // victim's email and inherit the account once the victim verifies.
    await withTransaction(async (tx) => {
      await authRepo.updatePasswordHashById(existingUser.id, hashedPassword, tx);
      await issueVerification(existingUser, tx);
    });

    logInfo("Unverified re-register, verification reissued", {
      userId: existingUser.id,
    });
    return { user: existingUser };
  }

  const displayId = idGenerators.displayId(12) as DisplayID;
  const username = idGenerators.displayId(10);
  const role = shouldBeSuperuser(input.email, options.superuserEmails)
    ? "superuser"
    : "user";

  const user = await withTransaction(async (tx) => {
    const newUser = await authRepo.create(
      input.email,
      hashedPassword,
      displayId,
      role,
      false,
      tx
    );

    // No stored avatar: the UI derives a default from the username
    // (ui-avatars) when avatarUrl is null, so it follows username changes.
    await profileRepo.create(
      {
        userId: newUser.id,
        username,
      },
      tx
    );

    await issueVerification(newUser, tx);

    return newUser;
  });

  logInfo("User registered, verification pending", { userId: user.id });
  return { user };
}

// Verify the pending OTP; on success the account flips verified and the
// session token is minted here (the only mint path for a new account).
export async function verifyEmail(
  input: VerifyEmailRequest,
  options: { jwtExpiresIn?: string; superuserEmails?: string[] } = {}
): Promise<{ user: User; token: string }> {
  const normalizedEmail = input.email.toLowerCase().trim();
  const user = await authRepo.findByEmail(normalizedEmail);

  // Unknown email, already-verified account, and missing/expired/wrong codes
  // are indistinguishable to the caller.
  if (!user || user.verified) {
    logWarn("Verification failed: no pending verification", {
      email: normalizedEmail,
    });
    throw invalidCode();
  }

  const verification = await authRepo.findActiveVerificationByUserId(user.id);
  if (!verification) {
    logWarn("Verification failed: no active code", { userId: user.id });
    throw invalidCode();
  }

  const { maxAttempts } = staticConfig.emailVerification;
  if (verification.attempts >= maxAttempts) {
    logWarn("Verification blocked: attempt cap", { userId: user.id });
    throw tooManyAttempts();
  }

  if (verification.expiresAt.getTime() <= Date.now()) {
    logWarn("Verification failed: code expired", { userId: user.id });
    throw invalidCode();
  }

  if (!verifyOtpCode(input.code, verification.salt, verification.codeHash)) {
    const attempts = await authRepo.incrementVerificationAttempts(
      verification.id
    );
    logWarn("Verification failed: wrong code", {
      userId: user.id,
      attempts,
    });
    throw attempts >= maxAttempts ? tooManyAttempts() : invalidCode();
  }

  let verifiedUser = await withTransaction(async (tx) => {
    await authRepo.consumeVerification(verification.id, tx);
    return (await authRepo.setVerifiedById(user.id, tx)) ?? user;
  });

  verifiedUser = await promoteConfiguredSuperuser(
    verifiedUser,
    options.superuserEmails
  );

  const token = await signSessionToken(
    { userId: verifiedUser.id },
    { expiresIn: options.jwtExpiresIn }
  );

  logInfo("Email verified", { userId: verifiedUser.id });
  return { user: verifiedUser, token };
}

// Always resolves: unknown email, already-verified account, and cooldown
// suppression all look identical to the caller (no enumeration surface).
export async function resendVerification(
  input: ResendVerificationRequest
): Promise<void> {
  const normalizedEmail = input.email.toLowerCase().trim();
  const user = await authRepo.findByEmail(normalizedEmail);

  if (!user || user.verified) {
    logInfo("Resend no-op", { email: normalizedEmail });
    return;
  }

  const issued = await withTransaction(async (tx) =>
    issueVerification(user, tx)
  );

  logInfo(issued ? "Verification resent" : "Resend suppressed by cooldown", {
    userId: user.id,
  });
}

export async function login(
  input: LoginRequest,
  options: { jwtExpiresIn?: string; superuserEmails?: string[] } = {}
): Promise<{ user: User; token: string }> {
  const normalizedEmail = input.email.toLowerCase().trim();
  let user = await authRepo.findByEmail(normalizedEmail);
  if (!user) {
    // Spend the same work as a real verify, then return the same error as a
    // wrong password, so a missing account is indistinguishable to the caller.
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    logWarn("Login failed: user not found", { email: normalizedEmail });
    throw unauthorized("Invalid credentials", {
      code: "INVALID_CREDENTIALS",
    });
  }

  const isValidPassword = await verifyPassword(
    input.password,
    user.passwordHash
  );
  if (!isValidPassword) {
    logWarn("Login failed: invalid password", { userId: user.id });
    throw unauthorized("Invalid credentials", {
      code: "INVALID_CREDENTIALS",
    });
  }

  // Hard verify gate. Distinct from 401 by design: the web client resumes the
  // verify flow on this code (accepted enumeration tradeoff, ADR 0002 —
  // register's 409 already reveals account existence).
  if (!user.verified) {
    logWarn("Login blocked: email not verified", { userId: user.id });
    throw forbidden("Email not verified", {
      code: "EMAIL_NOT_VERIFIED",
    });
  }

  user = await promoteConfiguredSuperuser(user, options.superuserEmails);

  const token = await signSessionToken(
    { userId: user.id },
    { expiresIn: options.jwtExpiresIn }
  );

  logInfo("User logged in", { userId: user.id });
  return { user, token };
}

export async function getCurrentUser(sessionToken: string): Promise<User> {
  try {
    const { userId } = await verifySessionToken(sessionToken);
    const user = await authRepo.findById(userId);

    if (!user) {
      logWarn("Session invalid: user not found", { userId });
      throw unauthorized("User not found", {
        code: "USER_NOT_FOUND",
      });
    }

    return user;
  } catch (error) {
    logWarn("Session verification failed");
    throw unauthorized("Invalid session token", {
      code: "INVALID_SESSION",
    });
  }
}

export async function getUserById(userId: string): Promise<User> {
  const user = await authRepo.findById(userId as any);

  if (!user) {
    throw notFound("User not found", {
      code: "USER_NOT_FOUND",
    });
  }

  return user;
}

export async function ensureDefaultSuperuser(input?: {
  email: string;
  password: string;
}): Promise<User | null> {
  if (!input) {
    return null;
  }

  const email = input.email.toLowerCase();
  const existing = await authRepo.findByEmail(email);

  if (existing) {
    if (existing.role !== "superuser") {
      logWarn("Default superuser email already exists without superuser role", {
        userId: existing.id,
      });
      return null;
    }
    return existing;
  }

  const hashedPassword = await hashPassword(input.password);
  const displayId = idGenerators.displayId(12) as DisplayID;
  const username = idGenerators.displayId(10);

  return withTransaction(async (tx) => {
    // Bootstrap account is config-owned, not self-registered: born verified.
    const user = await authRepo.create(
      email,
      hashedPassword,
      displayId,
      "superuser",
      true,
      tx
    );

    await profileRepo.create(
      {
        userId: user.id,
        username,
      },
      tx
    );

    logInfo("Default superuser bootstrapped", { userId: user.id });
    return user;
  });
}
