import { getDbClient } from "@/shared/database/client";
import type { TransactionClient } from "@/shared/database/transaction";
import {
  User,
  UserRole,
  EmailVerification,
  OtpPurpose,
} from "@/modules/auth/auth.model";
import { UUID, DisplayID } from "@/shared/types/id";
import { idGenerators } from "@/shared/identity/generator";

const db = getDbClient();

function mapRow(row: any): User {
  return {
    id: row.id as UUID,
    displayId: row.display_id as DisplayID,
    email: row.email as string,
    role: row.role as UserRole,
    passwordHash: row.password_hash as string,
    verified: row.verified as boolean,
    failedLoginAttempts: row.failed_login_attempts as number,
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at || row.created_at),
  };
}

function mapVerificationRow(row: any): EmailVerification {
  return {
    id: row.id as UUID,
    userId: row.user_id as UUID,
    codeHash: row.code_hash as string,
    salt: row.salt as string,
    expiresAt: new Date(row.expires_at),
    attempts: row.attempts as number,
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    createdAt: new Date(row.created_at),
  };
}

export async function findByEmail(email: string): Promise<User | null> {
  const rows = await db`
    SELECT id, display_id, email, role, password_hash, verified, failed_login_attempts, locked_until, created_at, updated_at
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function findById(id: UUID): Promise<User | null> {
  const rows = await db`
    SELECT id, display_id, email, role, password_hash, verified, failed_login_attempts, locked_until, created_at, updated_at
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function create(
  email: string,
  passwordHash: string,
  displayId: DisplayID,
  role: UserRole = "user",
  verified = false,
  tx?: TransactionClient
): Promise<User> {
  const client = tx ?? db;
  const id = idGenerators.uuidv7();

  const rows = await client`
    INSERT INTO users (id, email, password_hash, display_id, role, verified)
    VALUES (${id}, ${email}, ${passwordHash}, ${displayId}, ${role}, ${verified})
    RETURNING id, display_id, email, role, password_hash, verified, failed_login_attempts, locked_until, created_at, updated_at
  `;
  return mapRow(rows[0]);
}

export async function updateRoleById(
  id: UUID,
  role: UserRole
): Promise<User | null> {
  const rows = await db`
    UPDATE users
    SET role = ${role}, updated_at = now()
    WHERE id = ${id}
    RETURNING id, display_id, email, role, password_hash, verified, failed_login_attempts, locked_until, created_at, updated_at
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function setVerifiedById(
  id: UUID,
  tx?: TransactionClient
): Promise<User | null> {
  const client = tx ?? db;
  const rows = await client`
    UPDATE users
    SET verified = true, updated_at = now()
    WHERE id = ${id}
    RETURNING id, display_id, email, role, password_hash, verified, failed_login_attempts, locked_until, created_at, updated_at
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

// Two callers: the unverified re-register path (ownership of the email is
// unproven, so the last registrant's password wins) and password reset.
export async function updatePasswordHashById(
  id: UUID,
  passwordHash: string,
  tx?: TransactionClient
): Promise<void> {
  const client = tx ?? db;
  await client`
    UPDATE users
    SET password_hash = ${passwordHash}, updated_at = now()
    WHERE id = ${id}
  `;
}

// Latest unconsumed row for a user and purpose (active OTP). Expiry and the
// attempt cap are checked in the service, not here, because the same row also
// answers the resend-cooldown question after it expires.
export async function findActiveVerificationByUserId(
  userId: UUID,
  purpose: OtpPurpose,
  tx?: TransactionClient
): Promise<EmailVerification | null> {
  const client = tx ?? db;
  const rows = await client`
    SELECT id, user_id, code_hash, salt, expires_at, attempts, consumed_at, created_at
    FROM email_verifications
    WHERE user_id = ${userId}
      AND purpose = ${purpose}
      AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows.length ? mapVerificationRow(rows[0]) : null;
}

export async function insertVerification(
  input: {
    userId: UUID;
    purpose: OtpPurpose;
    codeHash: string;
    salt: string;
    expiresAt: Date;
  },
  tx: TransactionClient
): Promise<void> {
  await tx`
    INSERT INTO email_verifications (user_id, purpose, code_hash, salt, expires_at)
    VALUES (${input.userId}, ${input.purpose}, ${input.codeHash}, ${input.salt}, ${input.expiresAt})
  `;
}

// Resend reuses the row: fresh code/salt/expiry, attempts reset, created_at
// bumped so the cooldown window restarts.
export async function rotateVerification(
  id: UUID,
  input: { codeHash: string; salt: string; expiresAt: Date },
  tx: TransactionClient
): Promise<void> {
  await tx`
    UPDATE email_verifications
    SET code_hash = ${input.codeHash},
        salt = ${input.salt},
        expires_at = ${input.expiresAt},
        attempts = 0,
        created_at = now()
    WHERE id = ${id}
  `;
}

export async function incrementVerificationAttempts(
  id: UUID
): Promise<number> {
  const rows = await db`
    UPDATE email_verifications
    SET attempts = attempts + 1
    WHERE id = ${id}
    RETURNING attempts
  `;
  return rows.length ? (rows[0].attempts as number) : 0;
}

export async function consumeVerification(
  id: UUID,
  tx: TransactionClient
): Promise<void> {
  await tx`
    UPDATE email_verifications
    SET consumed_at = now()
    WHERE id = ${id}
  `;
}

// Counted in the DB, not in memory: concurrent wrong-password attempts must
// each move the counter (the returned value is the post-increment count).
export async function incrementFailedLogin(id: UUID): Promise<number> {
  const rows = await db`
    UPDATE users
    SET failed_login_attempts = failed_login_attempts + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING failed_login_attempts
  `;
  return rows.length ? (rows[0].failed_login_attempts as number) : 0;
}

export async function setLockedUntil(id: UUID, lockedUntil: Date): Promise<void> {
  await db`
    UPDATE users
    SET locked_until = ${lockedUntil}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function resetLoginLock(
  id: UUID,
  tx?: TransactionClient
): Promise<void> {
  const client = tx ?? db;
  await client`
    UPDATE users
    SET failed_login_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE id = ${id}
  `;
}
