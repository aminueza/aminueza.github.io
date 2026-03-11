---
layout: post
title: "When Every Alert Is Critical, Nothing Is"
date: 2026-03-11
tags: [Observability, Grafana, Alerting, SRE, On-Call]
description: "How to build a Grafana IRM alert routing pipeline with notification policies, escalation chains, on-call schedules, and label-based routing. Terraform configuration included."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
redirect_from: /blog/2026/03/11/your-alerts-are-just-noise/
series: "Observability"
series_part: 3
---

You have 100 alerts. 80 of them are informational. 15 are warnings that nobody looks at. 4 are actual problems. And 1 is critical, buried in a Slack channel with 200 unread messages. The on-call person didn't see it because every alert looks the same: a wall of orange text in `#alerts` that everyone muted weeks ago.

This is what happens when you treat alerting as "create rule, send to Slack, done." The alert fires. But the routing, escalation, and human response? That's where most teams have nothing. So let's build the pipeline that turns a fired alert into the right person looking at the right thing.

## The Alert Flow

An alert in Grafana travels through a chain before reaching a person. Each step narrows the audience and increases the urgency:

![Grafana IRM Alert Flow](/assets/images/posts/grafana-irm-alert-flow.svg)

**Notification Policy** matches the alert's labels against routes. The first matching route wins. Routes whose labels contain `critical` are evaluated first, then `high-urgency` escalation policies, then everything else.

**Contact Point** bridges the policy to an IRM integration, a unique webhook endpoint per route. Every route gets one, even non-escalating routes, so all alerts appear in the IRM timeline regardless of severity.

**Escalation Chain** defines what happens next. For non-production routes, the chain is empty: the alert is received, posted to Slack, and nobody is paged. For production routes, the chain has steps: notify on-call, wait 5 minutes, notify the team. For critical routes, the on-call person gets paged immediately.

## The Configuration Model

The entire routing setup is driven by three variables in a single tfvars file. No clicking around in UIs, no undocumented Slack integrations.

**Notification policy** controls grouping. Alerts sharing the same `alertname`, `environment`, `service`, `team`, and `severity` batch into a single notification. This is critical: without grouping, one failing service generates a notification per firing rule per evaluation interval. That's a flood, not an alert.

**Escalation policies** are named and reusable. Define `high-urgency` once (notify on-call, wait 5 min, notify team) and every team references it by name. No drift where two teams think they have the same escalation but don't.

```hcl
escalation_policies = {
  high-urgency = {
    group_wait      = "10s"
    repeat_interval = "30m"
    steps = [
      { type = "notify_on_call_from_schedule" },
      { type = "wait", duration_minutes = 5 },
      { type = "notify_team_members" },
    ]
  }
}
```

**Team config** maps teams to their routes. Each route has label matchers, a Slack channel, and optionally an escalation policy:

```hcl
routes = [
  {
    name              = "alerts-infra-critical"
    labels            = ["environment=prd", "severity=critical"]
    slack_channel     = "#alerts-infra-critical"
    escalation_policy = "high-urgency"
  },
  {
    name          = "alerts-infra-stg"
    labels        = ["environment=stg"]
    slack_channel = "#alerts-infra-stg"
    # no escalation_policy = alert received, nobody paged
  }
]
```

That's the pattern. Non-production routes have no escalation policy. They get a Slack message and that's it. Production warnings notify the team. Critical alerts page on-call. The routing is driven entirely by labels on the alert, not by alert names or rule groups.

## One Schedule Per Team

The on-call schedule is a team-level construct, not a per-alert one. All escalating routes for a team share a single schedule. This reflects reality: the person on call for infra handles all infra alerts, not a curated subset.

Schedules are 24/7 rolling weekly rotations defined in Terraform. Temporary overrides (sick days, holiday swaps) are handled in the Grafana UI because they change too often to track in code. Permanent rotation changes go through tfvars.

## The Opinionated Bits

**All routes get a full integration.** Even non-escalating stg/dev routes create an IRM integration and contact point. This means every alert flows through the IRM timeline. One place to see all alert activity, not just the pages that woke someone up.

**Label-based routing, always.** Routing is decoupled from alert authoring. A correctly-labelled alert routes correctly without touching the IRM config. This means teams can create new alert rules without an infra change, as long as the labels follow the contract.

**Named policies prevent drift.** Two teams using "high-urgency" get the exact same behavior. If the escalation needs to change, it changes once, for everyone. The tradeoff is less per-route flexibility, which is the point.

## What's Still Missing

**Alert inhibition.** When a host goes down and generates 20 downstream alerts, all 20 currently route and can trigger pages. Grafana supports inhibition rules, but they're not configured yet. This is the single biggest source of alert fatigue in production.

**Runbook links.** Escalation chains route alerts to people but carry no context about what to do. Alert rules should include a `runbook_url` annotation that surfaces in the Slack notification. The on-call person at 3 AM shouldn't have to search Notion for triage steps.

**Maintenance windows as code.** Silencing alerts during planned maintenance is currently a manual UI operation. It should be a `grafana_silence` resource in Terraform, tracked in version control alongside the infrastructure it covers.

Next up: [The Alert Checklist Nobody Follows](/blog/2026/03/11/the-alert-checklist-nobody-follows/) covers how to write alerts that actually work with this routing model.

Until then, go check your Slack alert channels. If you've muted any of them... that's the symptom right there ;)

---

*This is part 3 of the Observability series. Previous: [The Four Numbers That Tell You Everything](/blog/2026/03/11/the-four-numbers-that-tell-you-everything/). Next: [The Alert Checklist Nobody Follows](/blog/2026/03/11/the-alert-checklist-nobody-follows/).*
