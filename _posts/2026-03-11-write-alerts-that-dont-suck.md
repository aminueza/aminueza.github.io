---
layout: post
title: "The Alert Checklist Nobody Follows"
date: 2026-03-11
tags: [Observability, Grafana, Alerting, SRE, On-Call]
description: "Most alerts describe the cause, not the symptom. They fire on single data points. They have no runbook. Here's the label contract and checklist that fixes all of it."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

Your alert is called `NginxDown`. It fires when the nginx pod restarts. The on-call person gets paged, opens Grafana, sees "NginxDown," and thinks "OK, nginx is down." Except nginx restarted because the node ran out of memory, which happened because the batch job that runs at midnight leaked memory, which happened because someone deployed a new version at 5 PM without load testing.

The alert described the **cause**, not the **symptom**. A better name: `HighErrorRate` or `APILatencyDegraded`. Those tell you what the user is experiencing, not what component failed. The component is for investigation. The symptom is for alerting.

This is one of many ways alerts go wrong. Here's the full contract.

## The Three Required Labels

Every alert rule must include these labels. The routing pipeline from my previous post depends on them:

| Label | Values | Purpose |
|---|---|---|
| `environment` | `dev`, `stg`, `prd` | Routes to the correct channel |
| `severity` | `critical`, `warning`, `info` | Determines whether someone gets paged |
| `team` | `infra`, `platform`, etc. | Identifies the owning team |

If any of these are missing, the alert either routes to the wrong place, doesn't escalate when it should, or (worst case) pages the wrong team at 3 AM. I've seen all three.

## The Severity Contract

This is the part that generates the most arguments. So let me be blunt:

**Critical** means production is down or severely degraded. Users are impacted right now. The on-call person gets paged immediately. If you're using this for "disk is at 80%," you're doing it wrong. Critical is for "the API is returning 500s to customers."

**Warning** means something needs attention but isn't causing user impact yet. Notify the team in Slack. Address during business hours unless it worsens. Disk at 80% is a warning. Connection pool nearing capacity is a warning. These are "fix it before it becomes critical" signals.

**Info** means no action required. Informational signal only. Route to a low-noise channel. Deployment succeeded. Backup completed. Cert renewed. If nobody needs to do anything, it's info.

The most common mistake: making everything `critical`. When everything is critical, nothing is. Your on-call person stops trusting the alerts, mutes the channel, and misses the one that actually matters. Severity inflation is worse than no alerting at all, because it creates the illusion of coverage.

## Name the Symptom, Not the Cause

Good alert names describe what the user experiences:

- `HighErrorRate` - users are getting errors
- `APILatencyP95Above2s` - users are experiencing slow responses
- `QueueBacklogGrowing` - processing is falling behind

Bad alert names describe what broke internally:

- `PodCrashLooping` - so what? What's the user impact?
- `DatabaseConnectionPoolExhausted` - a cause, not a symptom
- `DiskUsageHigh` - maybe. Is anything actually affected?

Sometimes the cause-level alert makes sense (you do want to know about disk usage). But it should be `warning` severity, not `critical`, because disk at 90% isn't user-impacting until something fails to write.

## The `for` Clause: Stop Alerting on Blips

Every alert rule needs a `for` clause that requires the condition to be sustained before firing. `for: 5m` means the error rate must be elevated for 5 continuous minutes before anyone is notified.

Without it, a single bad data point pages someone. A deployment spike that recovers in 30 seconds triggers a critical alert. The on-call person wakes up, sees everything is fine, and now has trust issues with your alerting system.

`for: 5m` is a good default. `for: 2m` for critical. `for: 10m` for warnings.

## Annotations: The Context That Saves 20 Minutes

Labels route the alert. Annotations give the human context. Three annotations that every alert should have:

**`summary`**: one line of what's happening. "Error rate for payments API exceeded 5% in production."

**`description`**: what to check first. "Check the API logs in Grafana Explore. Look for 5xx in the last 15 minutes. Common causes: database timeout, upstream degradation."

**`runbook_url`**: link to triage steps. The on-call person at 3 AM shouldn't have to search Notion. If you don't have a runbook, that's a separate problem.

## Grouping: Don't Flood the Channel

Alerts sharing the same `alertname`, `environment`, `service`, `team`, and `severity` batch into a single notification. This means 10 instances of the same service all hitting high error rates produces one alert, not 10.

The grouping breaks when you put high-cardinality labels on alerts. `pod_name`, `instance`, `request_id` in alert labels means every pod gets its own notification. 50 pods = 50 notifications for the same incident. The on-call person gets 50 Slack messages in 30 seconds and their phone becomes a vibrator.

Keep alert labels low-cardinality. Use annotations or the alert description for instance-specific details.

## The Checklist

Before shipping any alert rule:

- Labels: `environment`, `severity`, `team` are present
- Name describes the symptom, not the cause
- `summary` annotation: one line of what's happening
- `description` annotation: what to check first
- `runbook_url` annotation: link to triage steps
- `for` clause: sustained condition, not a single data point
- No high-cardinality labels that break grouping

If every alert in your system passed this checklist, your on-call experience would be dramatically better. Not perfect, that requires alert inhibition and proper SLO-based alerting, but better than most teams have today.

Go review your last 5 fired alerts. How many have a summary? A runbook link? A `for` clause longer than 0 seconds? Start there :D

---

*This is part 4 of the Observability series. Previous: [When Every Alert Is Critical, Nothing Is](/blog/2026/03/11/your-alerts-are-just-noise/). Start from [part 1](/blog/2026/03/11/your-observability-is-just-three-dashboards/).*
