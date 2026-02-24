---
layout: post
title: "Your Azure Network Is a Flat Disaster"
date: 2026-02-24
tags: [Azure, Networking, Security, Cloud Architecture]
description: "Your one-VNet-to-rule-them-all worked for a startup. It's a liability now. How to re-architect Azure networking for compliance, isolation, and multi-region without six months of downtime."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

Hey, I know what happened. Your company started with one subscription, one VNet, and a dream. Someone created `vnet-main` with a /16, threw in a few subnets named `default`, `backend`, and `apps`, and called it a day. It worked! Your app talked to your database, your database talked to your cache, everything was on the same network, life was beautiful.

Then GDPR happened. And your US clients wanted their data in the US. And suddenly your "one VNet to rule them all" needs to exist in three regions, and your database in Europe can't legally replicate to your database in America, and your flat network doesn't know what a boundary is because everything can reach everything.

"But we have NSGs!" => Cool, you have 47 NSG rules that nobody remembers writing, half of them say `*` to `*`, and the other half were added at 2 AM during an incident and never removed.

Your flat network was fine for a startup. It's a liability for a company that handles customer data across regions. This post is for you, the engineer who got here organically and now needs to fix it without six months of downtime. If you're designing from scratch, even better: you get to skip the pain and go straight to the architecture.

## The Problem Nobody Talks About

Here's the thing about Azure networking that the tutorials skip: a VNet is not just a technical boundary, it's a **compliance boundary**. When your EU customer's data lives in a VNet that's peered to a VNet in the US, you haven't moved data yet. But you've created a **network path** where data *could* move. A misconfigured route, a service that resolves across the peering, a developer who hardcodes a cross-region connection string. Any of these turns "could" into "did." And in regulated environments, the existence of the path is the problem, not just the data flow. Your auditor won't care that nobody actually sent data across it. They'll care that it was possible.

Most companies figure this out the hard way. They start with one region, expand to two, realize they need isolation, and then spend six months re-architecting their network while production is running on it. That's like changing the engine while driving on the highway. Possible, but you'll lose some parts along the way.

## Hub-and-Spoke: The Boring Architecture That Actually Works

I'm not going to sell you on some cutting-edge pattern here. Hub-and-spoke has been around since physical data centers had actual hubs. The idea is simple:

- **Hub VNets** are the central nodes. They run shared services: VPN gateways, DNS resolvers, firewalls. No application workloads live here.
- **Spoke VNets** are where your apps run. Container Apps, databases, caches, VMs, whatever. Each spoke peers with its hub.
- **Zones** are geographic boundaries. One hub per zone. EU zone, US zone, APAC zone. Traffic stays in its zone unless you explicitly route it out.

![Hub-and-Spoke Topology](/assets/images/posts/hub-spoke-topology.svg)

"But that's so many VNets!" => Yes. That's the point. Each VNet is an isolation boundary. Your EU spokes can't accidentally talk to your US spokes. Your dev environment can't accidentally reach production. The network topology **enforces** the policies that your compliance team writes in documents nobody reads.

## Why Not Just Use Multiple Subscriptions?

I hear this a lot: "We'll just put EU in one subscription and US in another, problem solved." Subscriptions are billing and access boundaries, not network boundaries. Two VNets in different subscriptions can still be peered. It's literally one `az network vnet peering create` command. A subscription doesn't stop traffic, it stops who can click buttons in the Azure portal. That's not the same thing. Someone with Network Contributor on both subscriptions can peer them in 30 seconds, and now your "isolated" EU and US environments share a network path.

You need both: subscription isolation for access control AND network isolation for traffic control. Hub-and-spoke gives you the network side. RBAC gives you the access side. Neither replaces the other.

## The Three Zones

In my setup, I use three geographic zones:

| Zone | Hub Region | Why |
|---|---|---|
| Europe | West Europe | GDPR. EU customer data stays in EU. Period. |
| Americas | East US | US data sovereignty. Some clients require it contractually. |
| Asia-Pacific | Australia East | APAC data residency for Australian and Asian clients. |

Each zone has one hub and three meshed spoke regions. Why three spokes per zone? Primary region for production, secondary for disaster recovery, and a third for specific workloads (like GPU availability in Sweden, or Southeast Asia for latency).

Not all spokes are active from day one. Some are pre-provisioned so when the business says "we need a presence in Southeast Asia", the network is already there. VNets are free. The cost of having an empty VNet is zero. The cost of "we need networking in a new region and it takes 3 weeks" is a lot more than zero.

## The IP Address Question

"What CIDRs do I use?" is the question that haunts every infra engineer. My approach is **every region gets the same IP ranges**.

Yes, really. All three hubs use 10.0.0.0/16. All three dev pools use 10.20.0.0/14. Same ranges, every region.

"But won't they overlap?!" => Only if you peer them. And you won't. The whole point of zones is isolation. EU traffic never touches US networks. There's no peering between hubs. They're islands. Same CIDRs, zero conflict.

This makes the Terraform code beautifully simple. Every hub uses the same subnet layout, same netnums, same configuration. You loop over regions with `for_each` and the code is identical. No per-region CIDR exceptions, no "wait, what range did we use for EUS again?" moments.

There's one operational catch: if you see source IP `10.0.3.4` in a log, you don't know which region it came from. The IP alone is ambiguous. You need the zone context (resource group name, Log Analytics workspace, or a region tag) to disambiguate. In practice this is fine because logs always carry resource metadata, but it's worth knowing that IPs aren't globally unique in this design. They're unique *within* a zone.

The trade-off: you can never peer hubs directly. If you ever need private connectivity between EU and US, you'd need to re-IP one of them or use API Management/API Gateway for it. For a very regulated market, that's a feature, not a bug. Data residency means the zones **should not** be connected. The architecture makes the illegal thing impossible instead of just making it a policy.

## What Goes In The Hub?

Hubs are lean. They only run infrastructure services:

- **VPN Gateway** for corporate network connectivity. Your employees need to reach things in Azure from the office. The VPN terminates in the hub, not in every spoke.
- **DNS Resolver** so spokes can forward DNS to the hub, which resolves private endpoint addresses. More on this in a later post, because DNS deserves its own rant.
- **Firewall** to control what goes in and out. CI/CD runners and all spoke traffic, for example.
- **Firewall/Gateway Subnets**, the reserved subnets with Azure-required names. Even if you don't deploy a firewall on day one, reserve the subnet. Adding it later to an existing VNet is painless; not having room for it is not.

That's it. No application code, no databases, no "just put it in the hub for now." The hub is infrastructure only.

## What Goes In The Spokes?

Everything else. Each spoke gets subnets organized by workload type:

- **Container Apps** (subnets 0-9) for serverless workloads
- **Databases** (subnets 10-19) for PostgreSQL, Cosmos, whatever needs a delegated subnet
- **General** (subnets 20-29) for private endpoints, VMs, Key Vault, Private Link Services

Why the gaps? So you can add new subnets within each group without renumbering. Need a second Container App subnet? It gets number 2. Third database subnet? Number 12. The numbering scheme grows without breaking existing resources.

Every spoke gets the same layout. Same subnets, same numbering, same size. I don't care if a region only runs Container Apps, it still gets database subnets and VM subnets. Because the cost of an empty subnet is nothing, and the cost of "oh wait, we need to add a database in this region but there's no subnet for it" is a change request, a Terraform plan across the entire state, and a prayer that nothing else moves.

## "This Sounds Like a Lot of Work"

It is. Up front. But here's the thing: you do this work once, and then adding a new region is editing a tfvars file and running `terraform apply`. Adding a new spoke is adding an entry to a map. The architecture is designed so that the expensive thinking happens at design time, not at 11 PM when someone needs a new VNet in production.

The alternative is the flat network approach: fast to start, impossible to maintain, and eventually someone spends six months doing the migration you could have done in two weeks at the beginning.

## What's Next

Right now you might be thinking: "OK, hub-and-spoke makes sense, but managing 9 spoke peerings per environment, times 3 environments, that's 27 peering configurations. And I need to keep them consistent, add new ones when spokes are added, tear them down cleanly..." You're right. Manual peering management at this scale is its own disaster.

In my next post, I'll show you how Azure Virtual Network Manager (AVNM) automates all of it. Tag a VNet, it joins the right group, gets peered, gets mesh connectivity, gets the security baseline. Zero manual peering resources. It also manages IP address allocation so you never touch a CIDR spreadsheet again. That's the payoff for building this topology.

Until then, go check your VNets. If you see one called `default` with three subnets and a /16 CIDR, we need to talk :D
