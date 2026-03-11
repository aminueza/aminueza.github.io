---
layout: post
title: "Stop Managing Peerings Like It's 2019"
date: 2026-03-11
tags: [Azure, Networking, AVNM, Terraform, Cloud Architecture]
description: "Manual VNet peerings don't scale. Azure Virtual Network Manager automates topology, IPAM, and group membership with tags. Here's how to replace 54 peering resources with zero."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

So you read my last post and now you have a hub-and-spoke network with three zones, nine spokes, and a beautiful architecture diagram on your Linear that makes you feel smart. Congratulations. Now you need to connect all of it.

Let's do the math. 9 spoke VNets, each peered to its hub. Azure peerings are bidirectional, so that's 18 `azurerm_virtual_network_peering` resources. For one environment. Three environments? 54 peering resources. Add a new spoke and you're editing 6 files, creating 6 resources, and hoping you didn't typo a VNet ID.

"It's fine, I'll just use a for_each." => Sure, until Terraform tries to delete and recreate a peering because you renamed a map key. Enjoy your 5 minutes of downtime while production VNets can't talk to each other.

This is the problem with managing network topology in Terraform directly. Enter AVNM.

## Azure Virtual Network Manager: The Automation Layer

AVNM sits above your VNets and manages them as groups. Instead of individual peerings, you define **Network Groups** (collections of VNets), **Connectivity Configurations** (hub-spoke, mesh, or both), **Security Admin rules** (more on this in the next post), and **IPAM Pools** for automatic IP allocation.

The key insight: VNets join groups based on **tags**. Tag a new spoke, and AVNM picks it up automatically. It joins the right group, gets peered to the hub, gets mesh connectivity, gets the security baseline. No manual peering. No Terraform change.

```hcl
# This is all a spoke VNet needs to join the right group:
tags = {
  network_type        = "spoke"
  data_residency_zone = "eu"
  Environment         = "development"
}
```

Three tags. Change the environment tag from `development` to `Staging`, and the VNet leaves the dev group and joins staging. The topology reconfigures itself.

![Tag-Based Group Membership](/assets/images/posts/avnm-tag-membership.svg)

"That sounds like magic." => It's just a control plane doing control plane things. It takes a few minutes to propagate, which is slower than an explicit peering, but you're trading speed for sanity. I'll take sanity every time.

With three zones (eu, us, apac) and three environments (dev, stg, prd), you get nine network groups. Each gets hub-spoke topology, direct mesh between members, global mesh across regions, and hub gateway access. Dev spokes in Europe talk to each other and to the EU hub. They cannot talk to staging or US spokes. The topology enforces isolation without a single NSG rule.

## IPAM: Never Manage a Spreadsheet Again

IP address management is where infra teams go to lose their minds. It always starts with a Google Sheet called "IP Allocations" protected by the sacred covenant of "please don't edit rows 1-50." It ends with overlapping CIDRs because someone forgot to update the sheet. Or edited the wrong tab.

AVNM has built-in IPAM. You define pools, VNets request allocations automatically. No spreadsheets, no collisions.

![IPAM Pool Hierarchy](/assets/images/posts/ipam-pool-hierarchy.svg)

```
Root Pool: 10.0.0.0/8 (one per region, isolated)
  ├── Hub Pool:  10.0.0.0/16    → 1 hub VNet
  ├── Dev Pool:  10.20.0.0/14   → room for 32 spoke VNets
  ├── Stg Pool:  10.40.0.0/13   → room for 64 spoke VNets
  └── Prd Pool:  10.60.0.0/14   → room for 32 spoke VNets
```

"Why does staging get a bigger pool?" => Because staging environments accumulate. That "temporary" environment from six months ago that nobody deleted? Yeah. /13 gives 64 VNets worth of room for exactly that reason.

## The Tag Gotcha That Will Ruin Your Day

The `Environment` tag is **case-sensitive**. Dev uses lowercase `development`. Staging uses title-case `Staging`. Production uses title-case `Production`.

```
development  → eu-dev-spokes  ✓
Staging      → eu-stg-spokes  ✓
Production   → eu-prd-spokes  ✓
staging      → nothing        ✗ (VNet sits unpeered, nobody notices for a week)
```

I know. It's inconsistent. By the time we noticed, changing it would have required re-tagging every VNet in every environment. If you're building from scratch, pick one casing and stick with it. Learn from my mistakes :D

## When AVNM Makes Sense (and When It Doesn't)

**Use AVNM** when you have 10+ VNets, need consistent topology, want security baselines teams can't override, or need IPAM. **Skip it** when you have fewer than 5 VNets, need instant peering propagation, or your team isn't comfortable debugging tag membership issues.

The trade-off is real: more automation, less visibility. When peering works, you feel like a genius. When it doesn't, you're checking tags and deployment status, wondering why you didn't just write 54 peerings like a normal person. For a growing company, the automation wins by a mile. For a 3-VNet setup, it's like buying a forklift to move a chair.

One more thing: you only need **one** AVNM instance. Not per region, not per zone. One. It governs every VNet in every subscription. One ring to rule them all, except this time it's actually a good idea.

In my next post, I'll show you the security side of AVNM, and why your firewall is more than just a subnet with a reserved name.

Until then, go count your peering resources. If the number makes you uncomfortable, you know what to do ;)
