---
layout: post
title: "An AI That Watches My Cloud Network So I Don't Have To"
date: 2026-03-16
tags: [AWS, Azure, GCP, Networking, AI, SRE, Observability, Python, Open Source]
description: "How I built CloudLens, an open-source multi-cloud network intelligence platform that monitors topology across AWS, Azure, and GCP, tracks changes, runs compliance checks, and uses Claude to explain what's wrong."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

Someone asks "can you draw me our network topology?" and you open three consoles. AWS, Azure, GCP. You click through VPCs in one, VNets in another, VPC Networks in a third, and try to mentally stitch them together. By the time you've got half the picture, someone pings you on Slack and you lose it all.

Now multiply that by 4 AWS accounts, 35 Azure subscriptions, 6 GCP projects, and 80+ virtual networks. That's my Tuesday.

I got tired of being a human topology cache. So I built [CloudLens](https://github.com/aminueza/cloudlens) — and then gave it an AI brain so it could tell me what's wrong before I even ask.

## The Problem: Your Network Is Invisible

Most SRE teams have no idea what their network looks like *right now*. Not the architecture diagram from six months ago. Not what Terraform says it should be. Right now, across all clouds.

Which peerings silently disconnected? Are there CIDR overlaps between clouds? If the hub VNet in `westeurope` goes down, do the AWS workloads lose connectivity through the VPN tunnel? What changed in the last 24 hours across three providers?

If answering any of these requires opening a console, you don't have observability over your network. You have hope. Hope is not an SRE strategy.

## What CloudLens Does

Every 5 minutes, CloudLens queries AWS, Azure, and GCP APIs — pulling VPCs, VNets, peerings, firewalls, security groups, load balancers, private endpoints, and 15+ resource types. It normalizes everything into a common schema (an AWS VPC and an Azure VNet both become a `virtual_network`) and then does five things no cloud console can:

![CloudLens Architecture](/assets/images/posts/cloudlens-architecture.svg)

**Topology visualization.** D3.js renders your entire multi-cloud network as one interactive force-directed graph. Networks cluster by product, tint by provider. Peerings draw green when active, red when broken. Cross-cloud connections show as dashed lines. It's the architecture diagram you wish you had, except it's always current.

**Change tracking.** Every poll cycle diffs against the previous state. New VPC? Logged. Peering disconnected? Logged as critical. Security group removed from production? Flagged before your next coffee. The diff engine is cloud-agnostic — it compares normalized resources.

**Health checks and compliance.** Ten checks run every cycle: disconnected peerings, overlapping CIDRs, missing production firewalls, orphaned resources, cross-cloud coverage gaps. Results feed into an A-F health score. Custom compliance rules via the API.

**Blast radius analysis.** Click any resource, ask "what if this goes down?" CloudLens traces peering chains up to 3 hops deep — including cross-cloud connections — and uses Tarjan's algorithm to find articulation points. If removing one Transit Gateway disconnects AWS from Azure, you'll know before it happens.

**AI analysis.** Claude gets the full multi-cloud topology, recent changes, and health data as context. Not a generic chatbot. A network-aware assistant.

## Where the AI Actually Helps

The rule-based features cover the questions I anticipated. The AI handles the ones I didn't.

"Which production networks don't have a firewall, across all clouds?" — reads the topology, checks all three providers, answers in plain language.

"8 resources changed across AWS and Azure in the last hour. Coordinated deployment or something unexpected?" — correlates changes with topology context, checks if they match a known pattern like a Terraform apply rolling through environments.

During incidents, CloudLens snapshots the topology at incident time and attaches recent changes across all providers. Claude analyzes everything and generates a root cause hypothesis. This isn't AI replacing the SRE. It's AI doing the first 10 minutes of investigation so you start at minute 11 instead of minute 0.

The whole AI layer degrades gracefully. No API key? The platform works fully — topology, changes, health, blast radius. AI features fall back to keyword matching. The tool must be useful without AI. The AI makes it better, not functional.

## The Hard Part: Normalization

The engineering insight nobody warns you about: **normalization is 60% of the work**.

An AWS Security Group and an Azure NSG do the same thing but have completely different data structures. SGs scope per-ENI, NSGs scope per-subnet. GCP firewall rules are per-network. Normalizing these into one schema useful for analysis without losing provider-specific semantics was the real challenge. The trick: normalize common fields (name, type, network, rule count) and keep provider details in a `properties` dict for the AI to read when needed.

Every cloud also has a different query model. Azure Resource Graph lets you query everything in one KQL call. AWS has no equivalent — `describe_vpcs` per region per account. The provider abstraction hides this: from the outside, they all look the same.

And matching resources to networks is harder than it looks. Not every resource has a direct network association. CloudLens uses a four-level heuristic: NIC-based subnet lookup, single-network-in-account inference, name-based matching, region fallback. It correctly maps ~95% of resources.

## Running It

```bash
pip install "cloudlens[all-providers]"
export ANTHROPIC_API_KEY="sk-ant-..."  # optional
DASHBOARD_AUTH_DISABLED=true python3 main.py
# → http://localhost:8050
```

Cloud SDKs are optional extras. `pip install cloudlens[aws]` for AWS only. No API key? Everything works except AI chat gives basic answers. Per-provider auth status shows in the UI — AWS green, Azure red (token expired), GCP green. Fix one without affecting the others.

The whole thing is Python, FastAPI, D3.js, and SQLite. No React. No Node. One HTML file, one CSS file, one JS file. Deploy with `docker build` and go.

The source is at [github.com/aminueza/cloudlens](https://github.com/aminueza/cloudlens). If you're managing cloud networking at any scale — especially multi-cloud — give it a try.

Or just go check your peerings across all three consoles. If any of them say "Inactive"... we need to talk :D
