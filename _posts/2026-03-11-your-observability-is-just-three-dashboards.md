---
layout: post
title: "Three Dashboards Is Not Observability"
date: 2026-03-11
tags: [Observability, OpenTelemetry, Grafana, SRE, Cloud Architecture]
description: "Logs, metrics, and traces as separate tools isn't observability. OpenTelemetry with a collector pipeline gives you correlated signals, vendor neutrality, and one place to look."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

You have a logging dashboard. You have a metrics dashboard. You have a traces dashboard. When something breaks, you open all three, squint at timestamps trying to correlate them, and hope the clocks are synchronized. This is not observability. This is three dashboards and a prayer.

Real observability means your logs contain trace IDs, your traces link to metrics, and everything shares the same resource attributes so you can pivot between them instantly. "Show me the logs for this slow trace" should be one click, not a 15-minute archaeology expedition across three tools.

The answer is OpenTelemetry, and if you're not using it yet, you're building telemetry debt that gets harder to pay off every quarter.

## The Architecture: One Pipeline, Three Signals

OpenTelemetry (OTel) gives you a vendor-neutral framework for collecting all three signal types. Your apps use native OTel SDKs to emit logs, metrics, and traces through a single OTLP protocol. An OTel collector sits between your apps and your observability backend, receiving everything, filtering, enriching, and routing each signal to the right place.

![OpenTelemetry Collector Architecture](/assets/images/posts/otel-collector-architecture.svg)

The collector is the key piece. It's not just a proxy. It batches telemetry to reduce backend load, injects resource attributes (environment, region) so your apps don't have to, filters out noise, and routes logs to Loki, metrics to Mimir/Prometheus, and traces to Tempo (or whatever backend you use). One endpoint for your apps. Three destinations handled automatically.

"Why not send directly to the backend?" => Because then every app needs backend-specific configuration, you can't enrich telemetry centrally, and changing backends means changing every app. The collector decouples producers from consumers. Your apps speak OTLP. The collector speaks everything else.

## Auto vs. Manual Instrumentation

Start with **automatic instrumentation**. Every OTel SDK has auto-instrumentation that captures HTTP requests, database queries, and messaging spans out of the box. Zero code changes. You add a package, configure the OTLP endpoint, and deploy. Within minutes you have spans for every inbound request and every outbound call.

Then **enhance with manual instrumentation** where auto isn't enough. Business-meaningful spans like `document_processing.step` or `field_extraction.run` don't come from auto-instrumentation. Those require explicit code. The rule: deploy auto first, validate, then add manual spans for domain-specific visibility.

Don't try to instrument everything on day one. That's how you end up with 400 custom spans and no idea which ones matter.

## Resource Attributes: The Glue

Every piece of telemetry needs to answer "what emitted this?" That's what resource attributes do. They're metadata attached to every log, metric, and span from a service.

The minimum set every service must include:

```yaml
service.name:                "my-api"
service.namespace:           "payments"
service.version:             "v2.9.4"
team.name:                   "platform"
deployment.environment.name: "prd"
cloud.region:                "weu"
```

`service.name` identifies the workload. `service.namespace` groups related services into a product domain. `team.name` tells you who owns it at 2 AM. `deployment.environment.name` and `cloud.region` are ideally injected by the collector so apps don't hardcode them.

These six attributes make everything filterable, groupable, and correlatable. Without them, your telemetry is a pile of data. With them, it's a system.

## The Cardinality Trap

This is the single most expensive mistake in observability, and almost everyone makes it.

**Labels** (metric attributes) must be low-cardinality. That means `service.name`, `team.name`, `cloud.region`, things with a small, fixed set of values. **Never** put user IDs, session IDs, document IDs, timestamps, or UUIDs in metric labels. Each unique combination of labels creates a new time series. A label with 10,000 unique values creates 10,000 time series. Your metrics backend will either throttle you, charge you a fortune, or both.

High-cardinality values go in **span attributes** and **log attributes**, where they're stored as searchable fields but don't create time series. This is where `user_id`, `document_id`, `session_id` belong.

```
service.name="api"  team.name="payments"  → label (low cardinality, good)
user_id="e2c63c98"                        → span attribute (high cardinality, good)
user_id="e2c63c98"                        → metric label (high cardinality, EXPENSIVE)
```

If your Grafana Cloud bill suddenly spikes, check your custom metrics for high-cardinality labels. It's almost always that.

## Structured Logs or Nothing

Unstructured logs are useless at scale. `"Error processing request"` tells you nothing. Structured JSON logs with `trace_id`, `span_id`, severity, and resource attributes tell you everything:

```json
{
  "timestamp": "2026-03-03T11:53:45Z",
  "severity": "ERROR",
  "message": "Health check failed",
  "service.name": "my-worker",
  "trace_id": "8f3ec97fefe50bf6cc673c72ab32eefd",
  "span_id": "3bc0294cd9aa2006",
  "attributes": {
    "health_check_name": "azure_blob_storage",
    "status": "Unhealthy",
    "exception.type": "TaskCanceledException"
  }
}
```

The `trace_id` is the magic field. It lets Grafana pivot from this log directly to the trace that produced it, and from the trace to every other log and span in the same request. One click from "something failed" to "here's the entire request flow." That's observability.

Next up: [The Four Numbers That Tell You Everything](/blog/2026/03/11/the-four-numbers-that-tell-you-everything/) covers the Golden Signals that every service must emit.

Until then, go check your logs. If they're unstructured strings without trace IDs... we need to talk :D

---

*This is part 1 of the Observability series. Next: [The Four Numbers That Tell You Everything](/blog/2026/03/11/the-four-numbers-that-tell-you-everything/).*
