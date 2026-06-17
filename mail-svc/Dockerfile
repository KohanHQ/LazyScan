# Build context: mail-svc/ (compose build: ./mail-svc). Pure-Go, no cgo —
# mail-svc only consumes Redis + sends SMTP, never web-facing beyond /health.

FROM golang:1.26-alpine AS go-build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mail-svc ./cmd/mail-svc

FROM alpine:3.23

RUN apk add --no-cache wget && adduser -D -H app

COPY --from=go-build /out/mail-svc /usr/local/bin/mail-svc

USER app
EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8002/health >/dev/null || exit 1

CMD ["mail-svc"]
