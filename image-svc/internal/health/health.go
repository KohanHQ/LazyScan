// Package health serves Kiln's own liveness endpoint (compose-healthcheck
// parity with Aegis's /healthz) and, when wired, the Prometheus /metrics
// endpoint — same internal mux, port unpublished in compose.
package health

import (
	"io"
	"net/http"
	"time"
)

const (
	healthzPath = "/healthz"
	metricsPath = "/metrics"
)

// Handler answers /healthz — and /metrics when a metrics handler is wired;
// every other path is a 404. A nil metrics handler keeps the mux
// healthz-only (tests, rollback).
func Handler(metrics http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(healthzPath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = io.WriteString(w, `{"status":"ok","service":"kiln"}`+"\n")
	})
	if metrics != nil {
		mux.Handle(metricsPath, metrics)
	}
	return mux
}

// NewServer assembles the http.Server exposing the internal endpoints.
func NewServer(addr string, metrics http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           Handler(metrics),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}
