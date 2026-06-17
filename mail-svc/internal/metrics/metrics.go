// Package metrics owns the Prometheus registry and every herald_* metric
// (observability plan O3, Aegis precedent). It is the only package that
// imports client_golang; the processor and consumer feed it through
// nil-safe seams (processor.Observer, consumer.StreamObserver) and stay
// silent when unwired.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/LazyScan/Herald/internal/processor"
)

// Metrics holds the registry and the herald_* collectors. One instance is
// wired through main; the /metrics handler joins the internal healthz mux,
// never a web-reachable surface.
type Metrics struct {
	registry *prometheus.Registry

	eventsProcessed *prometheus.CounterVec
	eventDuration   *prometheus.HistogramVec

	streamPending       prometheus.Gauge
	streamOldestPending prometheus.Gauge
	poison              prometheus.Counter
}

// New builds a Metrics with its own registry (plus the standard go/process
// collectors). Metric names and labels follow the observability plan; the
// type label is always clamped to the known event types.
func New() *Metrics {
	m := &Metrics{
		registry: prometheus.NewRegistry(),
		eventsProcessed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "herald_events_processed_total",
			Help: "Events handled to a durable outcome (ok, dedup, or failed).",
		}, []string{"type", "outcome"}),
		eventDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "herald_event_processing_duration_seconds",
			Help:    "Time to handle one event to a durable outcome.",
			Buckets: prometheus.DefBuckets,
		}, []string{"type"}),
		streamPending: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "herald_stream_pending",
			Help: "Entries pending in the herald consumer group (XPENDING count).",
		}),
		streamOldestPending: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "herald_stream_oldest_pending_seconds",
			Help: "Age of the oldest pending entry, from its stream ID timestamp.",
		}),
		poison: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "herald_poison_total",
			Help: "Entries recorded as poison at the delivery threshold.",
		}),
	}

	m.registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		m.eventsProcessed,
		m.eventDuration,
		m.streamPending,
		m.streamOldestPending,
		m.poison,
	)
	return m
}

// Handler serves the registry in the Prometheus text format. Mounted only
// on the internal healthz mux (the port stays unpublished in compose).
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// EventProcessed implements the processor Observer seam: one event reached
// a durable outcome.
func (m *Metrics) EventProcessed(eventType, outcome string, seconds float64) {
	t := typeLabel(eventType)
	m.eventsProcessed.WithLabelValues(t, outcome).Inc()
	m.eventDuration.WithLabelValues(t).Observe(seconds)
}

// Poison implements the processor Observer seam: one entry recorded as
// poison at the delivery threshold.
func (m *Metrics) Poison() {
	m.poison.Inc()
}

// SetStreamPending implements the consumer StreamObserver seam (XPENDING
// poll: pending count).
func (m *Metrics) SetStreamPending(n float64) {
	m.streamPending.Set(n)
}

// SetStreamOldestPendingSeconds implements the consumer StreamObserver
// seam (XPENDING poll: age of the oldest pending entry).
func (m *Metrics) SetStreamOldestPendingSeconds(s float64) {
	m.streamOldestPending.Set(s)
}

// typeLabel clamps the producer-controlled eventType to the known set so
// the label stays bounded (cardinality discipline).
func typeLabel(eventType string) string {
	if eventType == processor.EventTypeVerificationRequested {
		return eventType
	}
	return "other"
}
