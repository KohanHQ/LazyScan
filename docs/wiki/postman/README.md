# Postman Collection

In-repo Postman collection for the LazyScan API, synced from the codebase routes
(`api/src/modules/*/*.handler.ts`).

## Files

- `lazyscan.postman_collection.json` — the collection (Postman schema v2.1).
- `lazyscan.local.postman_environment.json` — local environment (variable values).

## Import

Postman → Import → drop both files. Select the **LazyScan — local** environment.

## Variables

| var | default | use |
|---|---|---|
| `base_url` | `http://localhost:3000/api/v1` | versioned business routes |
| `root_url` | `http://localhost:3000` | ops routes (`/health`, `/metrics`) |
| `image_svc_url` | `http://localhost:8001` | image-svc `/health`, `/convert` (internal) |
| `mail_svc_url` | `http://localhost:8002` | mail-svc `/health` (internal) |

Running through the nginx edge instead of the API directly? Point `base_url` at
`http://localhost:8080/api/v1` and `root_url` at `http://localhost:8080`. The
worker services are internal to the docker network — port-forward to reach them.

## Auth

Cookie-based. Run **Auth ▸ Register → Verify Email** (or **Login**) first; the
`session` cookie lands in Postman's cookie jar and authenticates the rest.

## Re-sync

The collection mirrors the handler routes. When routes change, update it (add the
request, fix the path/body) so it stays in sync — code is the source of truth.
