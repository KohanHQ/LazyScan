# Build context: this repo (LazyScan/docker-compose.yml uses
# build.context: ../Kiln). Aegis pattern, minus the web build stage —
# Kiln is never web-facing.

FROM golang:1.26-alpine AS go-build
WORKDIR /src

# libvips for the F5 image pipeline (govips is cgo).
RUN apk add --no-cache vips-dev build-base pkgconfig

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/kiln ./cmd/kiln

FROM alpine:3.23

RUN apk add --no-cache vips && adduser -D -H kiln

COPY --from=go-build /out/kiln /usr/local/bin/kiln

USER kiln
EXPOSE 8085

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8085/healthz >/dev/null || exit 1

CMD ["kiln"]
