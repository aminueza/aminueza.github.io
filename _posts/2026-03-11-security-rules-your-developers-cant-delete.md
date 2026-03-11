---
layout: post
title: "Security Rules Your Developers Can't Delete"
date: 2026-03-11
tags: [Azure, Security, AVNM, Firewall, Cloud Architecture]
description: "NSGs are suggestions. AVNM Security Admin rules are enforced. How to build a security baseline that developers can't bypass, plus centralized egress with Azure Firewall."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

You know that feeling when you spend two hours crafting the perfect NSG rules for your production subnet, push the change through your pipeline, and feel good about your security posture? And then on Monday, someone with Contributor access adds a rule that allows SSH from `0.0.0.0/0` because "I just need to debug something real quick, I'll remove it later."

They never remove it. Three months later, your security audit finds it. The person who added it doesn't even work here anymore. Their LinkedIn says "Cloud Architect" now, which is fitting because they certainly left you something to architect around.

NSGs are great. They're also completely useless as a security boundary because **anyone with write access to the resource group can modify them**. Every NSG rule you write is really just a suggestion that your team can override at any time.

This is the problem AVNM Security Admin solves.

## Security Admin Rules: The Override That Can't Be Overridden

AVNM Security Admin Configurations sit **above** NSGs in the evaluation order. If an AVNM rule says "deny SSH from internet," it doesn't matter what the NSG says. The traffic is blocked. Period. A developer can add `Allow SSH from * to *` and it will have zero effect.

- NSG rules = "please don't do this" (advisory, modifiable by contributors)
- AVNM Security Admin rules = "you literally cannot do this" (enforced by the management plane)

The only people who can change these rules have permissions on the AVNM resource itself, which lives in the connectivity subscription that developers don't have access to.

![Security Rule Evaluation Order](/assets/images/posts/security-evaluation-order.svg)

## The Baseline: Seven Rules

Here's our actual baseline. Not forty-seven rules that nobody understands. Seven.

**Allow outbound HTTPS to Azure services (priority 90)** so apps can reach Storage, Key Vault, Container Registry. The "keep the lights on" rule.

**Allow RDP and SSH from VPN only (priorities 94-97).** Two VPN ranges, two protocols, four rules. If you're on the VPN, you can access machines. If you're not, you can't. No exceptions.

**Deny RDP and SSH from internet (priorities 100-101).** This is the whole point. Denied globally, across every VNet, every environment, every region. A developer cannot override this. The only way to change it is to modify the AVNM configuration.

"But what if someone REALLY needs SSH from the internet?" => They don't. They need SSH from the VPN. If the VPN is down, fix the VPN. Don't poke holes in your firewall because the front door is stuck.

## The Two-Layer Model

In practice, you need both. **Layer 1** is AVNM Security Admin for the hard rules: block internet RDP/SSH, allow VPN access, allow Azure service outbound. Applied to all 9 network groups automatically. This is the floor. You can't go below it.

**Layer 2** is your Spoke Shared NSG for the soft rules: hub-to-spoke traffic, VPN-to-spoke, spoke-to-hub, container apps to hub services. Teams can extend these but not weaken them, because Layer 1 always wins.

## The Firewall: Your Controlled Exit

NSGs and AVNM rules handle traffic between your VNets. But what about traffic going to the internet? That's where Azure Firewall comes in.

Every hub has an Azure Firewall (Standard SKU) that mainly serves our CI/CD runners. Those runners need internet access to pull images, download packages, and clone repos. But "need internet access" and "should have unrestricted internet access" are very different sentences, and the firewall enforces that difference.

![Centralized Egress with Azure Firewall](/assets/images/posts/firewall-egress-flow.svg)

The runners can reach GitHub, container registries, package managers, Azure services, and Terraform registry. Everything else is denied. A compromised runner can't phone home to a random IP. Is it perfect? No, some rules still use wildcard destinations. But it's dramatically better than "allow all outbound."

Next step: forced tunneling. Right now spokes reach the internet directly. It's like having a security guard at the front desk but leaving the back door wide open. AVNM routing configurations will eventually point all spoke traffic to the firewall, giving you centralized egress control, one set of logs, one place to block malicious destinations.

## The Cost of Doing Nothing

A misconfigured NSG costs you nothing until it costs you everything. An open SSH port is free until someone finds it. A flat network with no egress control works fine until a compromised container starts mining crypto and your cloud bill goes up 400%. Ask me how I know. Actually, don't. I'm still processing the invoice.

The AVNM security baseline + firewall combo makes the most common mistakes structurally impossible instead of just discouraged.

Next up: [It's Always DNS (And Here's Why)](/blog/2026/03/11/your-dns-is-broken-and-you-dont-know-it/) explains the DNS setup, because private endpoints are useless if your apps can't resolve them.

Until then, go check your NSGs. Search for rules with source `*` on ports 22 or 3389. If you find any... do it with AVNM so nobody can add them back ;)

---

*This is part 3 of the Azure Networking series. Previous: [AVNM Replaced 54 Peering Resources With Zero](/blog/2026/03/11/stop-managing-peerings-like-its-2019/). Next: [It's Always DNS](/blog/2026/03/11/your-dns-is-broken-and-you-dont-know-it/).*
