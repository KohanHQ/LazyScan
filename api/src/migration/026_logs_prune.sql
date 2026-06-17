-- Log pruning function for retention policy enforcement.
-- Deletes log entries older than the specified retention window (default 90 days).
-- Returns the number of deleted rows for auditability.
CREATE OR REPLACE FUNCTION prune_logs(retention_days INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM logs
  WHERE created_at < now() - (retention_days || ' days')::interval;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
