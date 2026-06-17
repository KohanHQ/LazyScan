import bcrypt from "bcrypt";

export type PasswordHash = string;

const DEFAULT_BCRYPT_COST = 12;

export async function hashPassword(
  password: string,
  cost = DEFAULT_BCRYPT_COST,
): Promise<PasswordHash> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("password must be a non-empty string");
  }

  const rounds = Number.isFinite(cost) ? Math.floor(cost) : DEFAULT_BCRYPT_COST;
  if (rounds < 4 || rounds > 31) {
    throw new Error("bcrypt cost must be between 4 and 31");
  }

  return bcrypt.hash(password, rounds);
}

export async function verifyPassword(
  password: string,
  passwordHash: PasswordHash,
): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) {
    return false;
  }

  if (typeof passwordHash !== "string" || passwordHash.length === 0) {
    return false;
  }

  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

export const passwordCrypto = {
  hashPassword,
  verifyPassword,
};
