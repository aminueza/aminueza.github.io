---
layout: post
title: "Terraform State Is a Liability"
date: 2026-03-11
tags: [Terraform, Azure, DevOps, Infrastructure as Code, Cloud Architecture]
description: "One state file for all networking is a ticking time bomb. How to split Terraform state by lifecycle, manage deployment order, and shrink your blast radius."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

Let me tell you a story. I had one Terraform state file for all my hub networking. Three hub VNets, three VPN gateways, three DNS resolvers, 25 private DNS zones, all their VNet links. One state. One `terraform apply`. Very elegant. I was very proud of myself.

Then I needed to change a VPN IPsec parameter in West Europe. Just one setting. I ran `terraform plan`, it evaluated 200+ resources across three regions. The plan showed 1 change. I ran `terraform apply`.

Somewhere around DNS zone 14, Azure throttled my API calls. The apply partially failed. My WEU VPN was updated, my EUS VPN was untouched, and three DNS zone links were stuck in a "creating" state. Nothing was broken, but my state file said something different from reality, and I had to run another apply to reconcile. At 2 AM. With coffee that was already cold and a cat that was judging me.

This is why I split my networking into five state files.

## The Split

```
terraform.vnm-global.tfstate        → AVNM, IPAM pools, security rules
terraform.hub-global.tfstate        → Hub VNets, VPN gateways, DNS resolvers
terraform.dns-global.tfstate        → Private DNS zones and VNet links
terraform.firewall-global.tfstate   → Azure Firewall and rules
terraform.spokes-dev.tfstate        → All spoke VNets for dev environment
```

![Five State Files, Five Blast Radii](/assets/images/posts/terraform-state-split.svg)

Five deployments. Five blast radii. Here's why.

**AVNM** rarely changes after initial setup. When it does, the change is global and you want to be very awake. The kind of change where you make coffee first, close Slack, and tell your team "I'm touching AVNM, don't panic." A separate state means you can't accidentally modify it while working on VPN config.

**Hub** VNets, VPN gateways, DNS resolvers. Three regions, one state. Hub changes are infrequent and the three hubs share identical config, so managing them together keeps them consistent. If you have regional teams, split by region. If one team manages everything, keep it together.

**DNS** zones almost never change. Keeping them in the hub state meant every hub plan evaluated 25 zones and their links. Splitting DNS was the easiest win I've ever had in infrastructure. Plans are faster. Both deployments are safer. Everyone's happier. Even the cat.

**Firewall** rules change frequently. Every new CI/CD dependency means a new rule. If the firewall were in the hub state, every rule change would also evaluate VNets and VPN gateways. The blast radius of "oops, I deleted a rule collection" shouldn't include VPN gateways.

**Spokes** are per environment: `spokes-dev`, `spokes-stg`, `spokes-prd`. Deploy dev first, verify, then staging, then production. A broken dev deployment never blocks production changes.

## The Deployment Order Problem

Split state files have **dependencies**. You can't deploy in any order.

```
1. AVNM           → Creates IPAM pools that hubs need
2. Hub             → Creates VNets that DNS and firewalls need
3. DNS + Firewall  → Need hub VNets/subnets (parallel to each other)
4. Spokes          → Needs AVNM for peering and hubs for connectivity
```

![Deployment Order DAG](/assets/images/posts/deployment-order-dag.svg)

Deploy DNS before the hub? VNet links fail. Deploy spokes before AVNM? VNets never join a network group. This ordering is enforced by convention and pipeline stages, not by Terraform. Terraform just reads data sources, and if the resource doesn't exist, it fails.

## Remote State Storage: The Foundation

Before you split anything, you need somewhere to put the state. Each subscription gets its own state storage: a Storage Account for the state files, a Key Vault for encryption, and network rules to lock down access. The naming follows the same convention as everything else:

```
rg-{team}-tfstate-{env}-{region}     → resource group
st{team}tfstate{env}{region}          → storage account (no hyphens)
cttfstate                             → blob container
statebucket/terraform.{app}.tfstate   → state file path
```

The state file path is the key part. Each application gets its own file within the same container: `terraform.hub-global.tfstate`, `terraform.dns-global.tfstate`, `terraform.spokes-dev.tfstate`. One storage account, many state files, each isolated by path.

Authentication uses OIDC (`use_oidc = true` in the backend config), so your CI/CD pipeline authenticates the same way it does for everything else. No storage keys stored as secrets. No SAS tokens to rotate. The state storage uses the same passwordless auth pattern as the rest of your infrastructure.

## Things That Will Bite You (Ask Me How I Know)

**Never `terraform apply` without reviewing the plan.** I once changed a tag value and Terraform cheerfully proposed to recreate 3 production VNets because tags are used in the `for_each` key. My heart rate still goes up thinking about it. Always plan, always review, always save the plan file.

**State locks: don't panic.** If Terraform crashes mid-apply, the lock stays. Resist the urge to `force-unlock` immediately. Maybe your coworker is mid-deploy. Only force-unlock when you're sure nobody else is using the state.

**Don't put secrets in state.** It's plain text. If your PostgreSQL password is a variable, it's in a JSON file in your storage account. Use Key Vault references or `sensitive` variables.

## The Trade-Off

More state files = smaller blast radius but more operational complexity. My rule of thumb: split when the lifecycles are different. DNS changes quarterly, firewall rules change weekly, VPN changes monthly. Different cadences, different state files.

Five state files is the sweet spot for a medium-sized company. But the principle is the same: **your state file boundary should match your blast radius boundary**.

Build it once, automate the repetitive parts, and make the wrong things impossible instead of just discouraged. Your future self will thank you. Or at least they won't curse your name. Which, in infrastructure, is basically the same thing :D
