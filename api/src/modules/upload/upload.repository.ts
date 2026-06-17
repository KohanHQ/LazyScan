import { getDbClient } from "@/shared/database/client";
import { select } from "@/shared/database/query";
import type { TransactionClient } from "@/shared/database/transaction";
import { Upload, CreateUploadInput, UploadStatus } from "@/modules/upload/upload.model";
import { UUID } from "@/shared/types/id";

const db = getDbClient();

const UPLOAD_COLUMNS = [
  "id",
  "user_id",
  "type",
  "status",
  "original_key",
  "processed_key",
  "original_url",
  "processed_url",
  "metadata",
  "error_message",
  "created_at",
  "updated_at",
] as const;

function mapRow(row: any): Upload {
  return {
    id: row.id as UUID,
    userId: row.user_id as UUID,
    type: row.type,
    status: row.status,
    originalKey: row.original_key,
    processedKey: row.processed_key,
    originalUrl: row.original_url,
    processedUrl: row.processed_url,
    metadata: row.metadata,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function create(
  input: CreateUploadInput & { originalKey: string },
  tx?: TransactionClient
): Promise<Upload> {
  const client = tx ?? db;

  const rows = await client`
    INSERT INTO uploads (user_id, type, status, original_key, metadata)
    VALUES (
      ${input.userId},
      ${input.type},
      'pending',
      ${input.originalKey},
      ${input.metadata ? JSON.stringify(input.metadata) : null}
    )
    RETURNING ${client([...UPLOAD_COLUMNS])}
  `;
  return mapRow(rows[0]);
}

export async function findById(id: UUID): Promise<Upload | null> {
  const rows = await select("uploads", UPLOAD_COLUMNS)
    .whereEq("id", id)
    .limit(1)
    .build();
  return rows.length ? mapRow(rows[0]) : null;
}

export async function findByIdForUser(
  id: UUID,
  userId: UUID
): Promise<Upload | null> {
  const rows = await select("uploads", UPLOAD_COLUMNS)
    .whereEq("id", id)
    .whereEq("user_id", userId)
    .limit(1)
    .build();
  return rows.length ? mapRow(rows[0]) : null;
}

export async function findByUserId(userId: UUID, limit = 20, offset = 0): Promise<Upload[]> {
  const rows = await select("uploads", UPLOAD_COLUMNS)
    .whereEq("user_id", userId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset)
    .build();
  return rows.map(mapRow);
}

export async function findPendingUploads(limit = 10): Promise<Upload[]> {
  const rows = await select("uploads", UPLOAD_COLUMNS)
    .whereEq("status", "pending")
    .orderBy("created_at", "asc")
    .limit(limit)
    .build();
  return rows.map(mapRow);
}

export async function updateStatus(
  id: UUID,
  status: UploadStatus,
  updates: {
    originalUrl?: string;
    processedKey?: string;
    processedUrl?: string;
    errorMessage?: string;
  } = {}
): Promise<Upload | null> {
  const rows = await db`
    UPDATE uploads
    SET
      status = ${status},
      original_url = COALESCE(${updates.originalUrl ?? null}, original_url),
      processed_key = COALESCE(${updates.processedKey ?? null}, processed_key),
      processed_url = COALESCE(${updates.processedUrl ?? null}, processed_url),
      error_message = COALESCE(${updates.errorMessage ?? null}, error_message),
      updated_at = now()
    WHERE id = ${id}
    RETURNING ${db([...UPLOAD_COLUMNS])}
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function deleteById(id: UUID): Promise<boolean> {
  const result = await db`
    DELETE FROM uploads
    WHERE id = ${id}
  `;
  return result.count > 0;
}
