import {
  Registry,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from "prom-client";

// Owns the Prometheus registry and every api metric (observability plan
// O4). Manual registry, not the prom-client default — same isolation as
// the Go services' own registries. The /metrics route is registered in
// app.ts ahead of the logger and rate-limit plugins so scrapes are
// unlogged and unthrottled; it is reachable only on :3000 (not in the
// Aegis routing contract — see known-constraints.md for the VPS rule).

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

const httpRequests = new Counter({
  name: "api_http_requests_total",
  help: "HTTP requests served (route = Elysia route template).",
  labelNames: ["route", "method", "status"] as const,
  registers: [registry],
});

const httpDuration = new Histogram({
  name: "api_http_request_duration_seconds",
  help: "HTTP request duration (route = Elysia route template).",
  labelNames: ["route"] as const,
  registers: [registry],
});

// Method label clamped to known verbs so the label set stays bounded
// (Aegis precedent — clients control the method string).
const KNOWN_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

function methodLabel(method: string): string {
  return KNOWN_METHODS.has(method) ? method : "other";
}

// Start times keyed by the Request object — no shared mutable state across
// concurrent requests, and entries vanish with the request (WeakMap).
const startTimes = new WeakMap<Request, number>();

// RED hooks: count and time every request by route template
// (`/manga/:id`, never the raw path — cardinality discipline). Unmatched
// requests (404 before routing) get the fixed `unmatched` label. The
// /metrics route itself is skipped — self-scrape noise.
//
// Attached directly on the root app in app.ts (not via a plugin): Elysia
// plugin lifecycle hooks are local-scoped by default and do not propagate
// to sibling routes — verified live, the plugin variant never fired.
export function metricsOnRequest({ request }: { request: Request }): void {
  startTimes.set(request, performance.now());
}

export function metricsOnAfterResponse(ctx: any): void {
  const { request, route, path, set } = ctx;
  if (path === "/metrics") {
    return;
  }
  const routeLabel = route || "unmatched";
  const status = String(set.status ?? 200);
  httpRequests.inc({
    route: routeLabel,
    method: methodLabel(request.method),
    status,
  });
  const start = startTimes.get(request);
  if (start !== undefined) {
    httpDuration.observe(
      { route: routeLabel },
      (performance.now() - start) / 1000
    );
  }
}
