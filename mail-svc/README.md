# Herald

LazyScan's detached email worker: Go + Redis Streams + Postgres outbox,
delivering register-verification OTP emails. Phase H4 — skeleton with a
log-only mailer ("would send"); SMTP via go-mail arrives at H5, compose
wiring at H6.

## Run

```sh
DATABASE_URL=... REDIS_URL=... go run ./cmd/herald
curl http://localhost:8086/healthz
```

Full env table: `docs/wiki/running.md`.

See `docs/wiki/` for the event contract, architecture, and session history.
The cross-service plan lives in
`../LazyScan/docs/wiki/herald-otp-plan.md`.
