-- Rows written via JSON.stringify were stored as JSONB string scalars, which
-- breaks ->> path queries and API object coercion. Unwrap them into objects.
UPDATE logs
SET context = (context #>> '{}')::jsonb
WHERE context IS NOT NULL AND jsonb_typeof(context) = 'string';

UPDATE uploads
SET metadata = (metadata #>> '{}')::jsonb
WHERE metadata IS NOT NULL AND jsonb_typeof(metadata) = 'string';
