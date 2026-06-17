import type { JSONValue } from "postgres";
import type { TransactionClient } from "@/shared/database/transaction";
import type { UUID } from "@/shared/types/id";

// Kiln event contract (Kiln/docs/wiki/event-contract.md). The outbox row's
// id/occurred_at come from DB defaults; the dispatcher builds the envelope
// from the row, so the column values here ARE the contract values.
export const CHAPTER_PAGE_PROCESSING_REQUESTED =
  "chapter.page.processing_requested";
export const CHAPTER_PAGE_EVENT_SCHEMA_VERSION = 1;

// Herald event contract. The payload carries
// the plaintext OTP code — the one exception to "IDs, not snapshots": Herald
// is a pure email projector with nothing to look up. Never log the code.
export const AUTH_EMAIL_VERIFICATION_REQUESTED =
  "auth.email.verification_requested";
export const AUTH_EMAIL_EVENT_SCHEMA_VERSION = 1;

export interface NewOutboxEvent {
  eventType: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: UUID;
  payload: JSONValue;
}

// tx is required, not optional: an outbox row written outside the same
// transaction as its status change breaks the transactional-outbox guarantee
// (event without state change, or state change without event).
export async function insertOutboxEvents(
  events: NewOutboxEvent[],
  tx: TransactionClient,
): Promise<void> {
  for (const event of events) {
    await tx`
      INSERT INTO outbox_events (
        event_type,
        schema_version,
        aggregate_type,
        aggregate_id,
        payload
      )
      VALUES (
        ${event.eventType},
        ${event.schemaVersion},
        ${event.aggregateType},
        ${event.aggregateId},
        ${tx.json(event.payload)}
      )
    `;
  }
}
