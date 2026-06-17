# Build context: this repo (the stack compose uses build.context: ./Herald
# from H6). Aegis pattern: pure-Go static build, no cgo, no web stage —
# Herald is never web-facing.

FROM golang:1.26-alpine AS go-build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/herald ./cmd/herald

FROM alpine:3.23

RUN adduser -D -H herald

COPY --from=go-build /out/herald /usr/local/bin/herald

USER herald
EXPOSE 8086

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8086/healthz >/dev/null || exit 1

CMD ["herald"]
