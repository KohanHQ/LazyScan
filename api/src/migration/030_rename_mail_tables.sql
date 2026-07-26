ALTER TABLE herald_processed_events RENAME TO mail_processed_events;
ALTER TABLE herald_failures RENAME TO mail_failures;

-- RENAME TO leaves the auto-named PK constraints on the old name, so they are
-- renamed explicitly; 023 declared no other named index or constraint here.
ALTER TABLE mail_processed_events
  RENAME CONSTRAINT herald_processed_events_pkey TO mail_processed_events_pkey;
ALTER TABLE mail_failures
  RENAME CONSTRAINT herald_failures_pkey TO mail_failures_pkey;
