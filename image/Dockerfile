# Build context: image/ (compose build: ./image). govips is cgo, so
# the build needs libvips + a C toolchain; the runtime needs libvips.

FROM golang:1.26-alpine AS go-build
WORKDIR /src

RUN apk add --no-cache vips-dev build-base pkgconfig

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/image ./cmd/image

FROM alpine:3.23

RUN apk add --no-cache vips wget && adduser -D -H app

COPY --from=go-build /out/image /usr/local/bin/image

USER app
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8001/health >/dev/null || exit 1

CMD ["image"]
