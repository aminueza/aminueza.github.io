---
layout: post
title: "Your Incident Process Is a Slack Message and a Prayer"
date: 2026-03-11
tags: [SRE, Incident Management, On-Call, Observability, DevOps]
description: "Someone posts 'is the API down?' in Slack. Three people investigate the same thing. Nobody updates customers. Here's the incident process that actually works."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

Someone posts "is the API down?" in a Slack channel. Three engineers start investigating independently. Nobody knows who's in charge. The product manager finds out from a customer tweet. Customer support has no talking points. Forty minutes later, someone restarts a pod and it fixes itself. No post-mortem. No timeline. No idea if it'll happen again tomorrow.

This is incident management at most companies. It works until it doesn't, which is usually when the incident is serious enough that the ad-hoc approach collapses under its own weight.

Google's [Site Reliability Engineering](https://sre.google/sre-book/managing-incidents/) book nails the core problem: **an unstructured incident response is slower, more chaotic, and more likely to make things worse than a structured one**. The structure doesn't need to be heavy. It needs to be clear.

## Three Roles, Assigned Immediately

The single most impactful thing you can do is assign three roles the moment an incident is declared. Not after triage. Not after root cause. Immediately.

**Incident Coordinator** (usually the engineering manager) owns the response. They track actions, maintain the timeline, ensure communication channels exist, and make sure nobody is working on the same thing in parallel. They don't fix the bug. They run the process.

**Technical Lead** (a senior developer) leads the investigation and fix. They coordinate engineering resources, decide on the remediation approach, and communicate technical findings.

**Communications Lead** (the product manager) handles everything non-technical. Internal updates to other teams. Customer-facing messages if needed. Coordination with support and customer success.

Google's [Incident Management chapter](https://sre.google/sre-book/managing-incidents/) calls this "clear, distinct roles" and it's the difference between a coordinated response and three people debugging the same thing in different terminals.

![Incident Response Flow](/assets/images/posts/incident-response-flow.svg)

## Severity Levels That Mean Something

P0 through P3, mapped to real impact thresholds:

| Level | User impact | Response | Update cadence |
|---|---|---|---|
| **P0 Critical** | >20% users affected | 15 minutes | Every 30 min |
| **P1 High** | 10-20% users | 30 minutes | Every 2 hours |
| **P2 Medium** | 5-10% users | 2 hours | Daily |
| **P3 Low** | <5% users | 8 hours | As needed |

Financial trigger: an unexpected cloud cost spike >50% is P1 minimum, regardless of user impact. Because nothing focuses the mind like watching your Azure bill climb in real time.

The key insight from Google's [Site Reliability Workbook](https://sre.google/workbook/incident-response/): severity determines **response time and update cadence**, not just who gets paged. A P0 means updates every 30 minutes whether you have new information or not. Silence during an incident is worse than "still investigating." Stakeholders who don't hear updates assume the worst.

## The Eight Steps

**1. Detect.** Alert fires, customer reports, someone spots it. Capture what, when, which system, known impact.

**2. Triage.** Is this actually an incident? If yes, proceed. If no, document and close. If unsure, check with the team. Don't spend 20 minutes debating whether something is an incident while users are affected.

**3. Classify.** Assign severity using the table above. Create a ticket. This is your record for post-mortem, audit, and SOC2.

**4. Mobilize.** Assign the three roles. Open a dedicated Slack channel (`#inc-2026-03-11-api-outage`). Pin the ticket. Set the topic to severity + status + next update time. Invite all stakeholders.

**5. Notify.** Post the first update immediately. Don't wait for root cause. "We're aware of elevated error rates on the API. Investigating. Next update in 30 minutes." That's enough. People need to know you're on it, not that you've solved it.

**6. Investigate and fix.** The Technical Lead drives this. Check runbooks. Check dashboards. Find the root cause or a mitigation. The Coordinator keeps the timeline updated. The Comms Lead keeps stakeholders informed.

**7. Resolve.** Deploy the fix. Verify via monitoring. Send the final update. Close the ticket. Archive the Slack channel. Update the runbook with what you learned.

**8. Post-mortem.** Mandatory for P0 and P1. Blameless. Timeline, root cause, what worked, what didn't, action items with owners and deadlines. Google's SRE book is emphatic on this: **a post-mortem that blames people teaches the organization to hide problems**.

## Communication Templates

Don't craft messages during an incident. Have templates ready: initial notification (severity, impact, roles, next update time), status updates (current action, ETA, next update), and resolution (duration, cause, fix, post-mortem date). Pre-written structure, fill in the blanks. The Comms Lead posts them on cadence in the incident Slack channel.

## The Post-Mortem That Actually Prevents Recurrence

The [SRE Workbook's post-mortem chapter](https://sre.google/workbook/postmortem-culture/) defines the standard: blameless, focused on systemic causes, with concrete action items.

The structure: **timeline** (what happened, when, who did what), **root cause** (why it happened, contributing factors), **impact** (scope, duration, user effect), **what worked well** (so you keep doing it), **what didn't** (so you fix it), and **action items** (with owners and deadlines, not "we should improve monitoring" but "add latency alert for payments API, owned by @name, due March 15").

The action items are the whole point. A post-mortem without action items is a story. A post-mortem with action items is a prevention plan. Track them. Review them monthly. If action items from three months ago are still open, your post-mortem process is theater.

Here's the template we use (works in Linear, Notion, or any ticket system):

```markdown
# [Incident Title] - Post-Incident Report

**Date:** YYYY-MM-DD | **Severity:** P0/P1/P2/P3
**Duration:** X hours | **Coordinator:** @name
**Tech Lead:** @name | **Comms Lead:** @name

## Description
One paragraph. What happened and what users experienced.

## Timeline
| Time | Event | Who | Action Taken |
|------|-------|-----|-------------|
| HH:MM | Alert fired / report received | | |
| HH:MM | Incident declared, roles assigned | | |
| HH:MM | Root cause identified | | |
| HH:MM | Fix deployed | | |
| HH:MM | Incident resolved | | |

## Impact Analysis
- **Scope:** X% of users/customers affected
- **Duration:** X hours of degraded service
- **Confidentiality:** Was data exposure possible? Y/N
- **Integrity:** Was data accuracy compromised? Y/N
- **Availability:** Was service availability affected? Y/N

## Containment
What was done to stop the bleeding before the permanent fix.

## Root Cause Analysis
Why it happened. Primary cause + contributing factors.

## Resolution
The permanent fix. What was deployed, changed, or reverted.

## Related Incidents
Links to upstream or related incidents, if any.

## What Worked Well / What Didn't
Honest retro. No blame, just systems thinking.

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| | @name | YYYY-MM-DD | Open |
```

The template forces structure. No "I'll write it up later" that turns into never. Fill it in as the incident progresses, not after.

## The On-Call Access Model

During incidents, responders need elevated access. The pattern: a PIM-eligible role (Contributor + Key Vault access, no customer data, no RBAC changes) activated with MFA, justification, and the incident ticket number. Capped at 4 hours. Manager approval required within 24 hours (but activation is instant because you can't wait for approval at 3 AM). No permanent elevated assignments.

This means: the on-call person can restart services, read secrets, modify networking, and scale resources. They cannot read customer databases, change permissions, or escalate their own access. The incident gets handled. The blast radius stays controlled.

## Further Reading

Everything here builds on three books: **[Site Reliability Engineering](https://sre.google/sre-book/table-of-contents/)** (Google, chapters 14-15 on incident management and post-mortems), **[The Site Reliability Workbook](https://sre.google/workbook/table-of-contents/)** (the practical companion, especially the incident response and post-mortem culture chapters), and **[Incident Management for Operations](https://www.oreilly.com/library/view/incident-management-for/9781491917619/)** by Rob Schnepp (more tactical, how to actually run the coordination). Start with the SRE book. The principles are universal.

Go check your last three incidents. Did they have a coordinator? A timeline? A post-mortem with tracked action items? If not... well, now you have the playbook :D
