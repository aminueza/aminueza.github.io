---
layout: post
title: "The Four Numbers That Tell You Everything"
date: 2026-03-11
tags: [Observability, SRE, Golden Signals, Grafana, Cloud Architecture]
description: "How to implement Google SRE Golden Signals with OpenTelemetry: latency histograms, error counters, traffic rates, and saturation gauges. One shared Grafana dashboard for every team."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
series: "Observability"
series_part: 2
---

Your service has 47 metrics. You have dashboards for CPU, memory, disk I/O, container restarts, pod count, HTTP status codes by path, database connection pool size, and that one custom metric someone added six months ago that nobody remembers the purpose of. When something breaks, you look at all of them and none of them tell you what's actually wrong.

Here's a radical idea from Google's SRE book that's been around for a decade and most teams still haven't implemented: you only need four numbers. Latency, errors, traffic, saturation. The Golden Signals. Everything else is supplementary.

![The Four Golden Signals](/assets/images/posts/golden-signals.svg)

## Latency: How Long Does It Take?

Instrument type: **Histogram**. Not a gauge, not an average. A histogram, because you need percentiles. p50 tells you the typical user experience. p95 tells you the slowest 5%. p99 is the pain point that support tickets come from.

The standard OTel metric is `http.server.request.duration_seconds`. Auto-instrumentation gives you this for free. For background workers or batch jobs, you'll need a custom histogram (`custom.task.execution.duration_seconds`).

```
histogram_quantile(0.95,
  sum(rate(http_server_request_duration_seconds_bucket[5m]))
  by (le, service.namespace)
)
```

Latency spikes are the **earliest** indicator of user-facing degradation. Your error rate might be zero and your traffic might be normal, but if p95 goes from 200ms to 2 seconds, something is very wrong. Users notice latency before they notice errors.

## Errors: How Often Does It Fail?

Instrument type: **Counter**. Errors accumulate over time and are never negative. HTTP auto-instrumentation captures 5xx responses automatically. For domain-specific failures, add a custom counter:

```
sum(rate(custom_service_errors_total[5m]))
  by (service.namespace)
```

Error rate is what SLO burn calculations use. "99.9% of requests succeed over 30 days" is a statement about your error counter. If you don't have one, you can't measure your SLO. And if you can't measure your SLO, you don't have one. You have a wish.

## Traffic: How Much Demand Exists?

Instrument type: **Counter** (Grafana computes the rate for you using `rate()`). Don't try to emit requests-per-second directly, just count requests and let the query do the math.

```
sum(rate(http_server_request_duration_seconds_count[5m]))
  by (service.namespace)
```

Traffic tells you about scaling behavior, queue pressure, and sudden load changes. A traffic drop can be as alarming as a traffic spike. If your API usually handles 500 req/s and it drops to 50, something upstream broke. Nobody's erroring, nobody's slow, they're just... not coming. Without a traffic signal, you'd never notice.

## Saturation: How Full Is the System?

Instrument type: **Gauge**. Saturation values fluctuate continuously. This is the one signal that's mostly **not your problem to emit**. CPU and memory come from the platform (container runtime, Kubernetes, Azure Container Apps). They're collected automatically.

What you might add: queue depth, in-flight request count, worker backlog, connection pool usage. These are app-level saturation signals that the platform can't see.

Saturation prevents the silent capacity problem. Your latency is fine, your errors are zero, your traffic is growing steadily, and then one day everything falls off a cliff because you hit a memory limit nobody was watching.

## The Labels That Matter

Every metric must include these low-cardinality labels:

```
service.namespace
service.name
service.version
team.name
deployment.environment.name
cloud.region
```

That's it. Six labels. One shared dashboard with filters for namespace and service name, and every team can see their Golden Signals without building a single custom dashboard.

**Do not** put `user_id`, `document_id`, `session_id`, or any other high-cardinality value in metric labels. That's a span attribute, not a label. I covered this in my previous post, but it's worth repeating because the Grafana Cloud bill that follows is not fun.

## SLO Boundary: Namespace, Not Workload

Here's the thing that trips teams up. Your SLO should be evaluated at the **service.namespace** level (the product/domain), not at the individual workload level.

Why? Because your product might have an API, a worker, and a scheduler. They're separate deployments, but reliability is measured by the product. If your API has 99.99% availability but your worker drops 5% of events, your **product** reliability is not 99.99%. Customers don't care which container failed. They care that their thing didn't work.

Workloads (`service.name`) roll up to their namespace. The namespace is the SLO boundary. The dashboard filters by namespace. Alerting fires on namespace-level error rates. Individual workloads are for debugging, not for SLO measurement.

## The One Dashboard

Here's the punchline. You don't need a dashboard per team. You need **one** Golden Signals dashboard with four panels (latency percentiles, error rate, traffic, saturation) and filters for `service.namespace`, `service.name`, `deployment.environment.name`, and `cloud.region`.

Every team selects their namespace. The data is there because every service emits the same six labels. No custom Grafana work per team. No "can you build us a dashboard?" tickets. One dashboard, four signals, every team.

That's what observability looks like when everyone speaks the same language.

Until then, go count your metrics. If the number makes you proud, you probably have too many. If you can point to four that answer "is my service healthy?"... you're already ahead of most teams :D

---

*This is part 2 of the Observability series. Previous: [Three Dashboards Is Not Observability](/blog/2026/03/11/three-dashboards-is-not-observability/). Next: [When Every Alert Is Critical, Nothing Is](/blog/2026/03/11/when-every-alert-is-critical-nothing-is/).*
