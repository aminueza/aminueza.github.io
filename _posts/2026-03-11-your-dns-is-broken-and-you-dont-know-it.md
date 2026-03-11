---
layout: post
title: "It's Always DNS (And Here's Why)"
date: 2026-03-11
tags: [Azure, DNS, Networking, Private Endpoints, Cloud Architecture]
description: "Private endpoints without proper DNS are expensive NICs nobody talks to. How to set up Azure Private DNS zones, hub resolvers, and debug the silent failures."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

Pop quiz. You deploy a PostgreSQL Flexible Server with a private endpoint. You configure your connection string to `mydb.postgres.database.azure.com`. You deploy. Timeout. You stare at your screen. The screen stares back.

You check the private endpoint, it exists. The subnet, correct. The NSG, port 5432 allowed. Everything IS correct. Except your app is resolving `mydb.postgres.database.azure.com` to a **public IP** instead of the private endpoint's IP. All traffic is going through the internet, hitting Azure's public endpoint, which rejects it because you disabled public access (as you should).

The private endpoint is there. But DNS doesn't know about it. And without DNS, private endpoints are just expensive NICs sitting in a subnet, alone, wondering why nobody calls.

This is the most common "everything is configured correctly but nothing works" problem in Azure networking. "We'll figure out DNS later." Famous last words.

![With vs. Without Private DNS Zone](/assets/images/posts/dns-with-without-zone.svg)

## How Azure Private DNS Actually Works

When you create a private endpoint, Azure doesn't magically make your VNet resolve the private IP. I know, I was disappointed too. You need a **Private DNS Zone** that maps the service's FQDN to the private endpoint's IP, and that zone needs to be **linked** to the VNets that need to resolve it.

```
mydb.postgres.database.azure.com
  → CNAME → mydb.privatelink.postgres.database.azure.com
    → Private DNS Zone lookup → 10.x.x.x (private endpoint IP)
```

Without the zone, Azure falls back to public DNS, returns the public IP, and your traffic goes out to the internet. Or doesn't come back at all. No error. No warning. Just a timeout.

"OK so I just need to create the DNS zone and link it." => Yes. For **every** service. Key Vault, Blob Storage, Redis, Container Apps, each has its own zone. There are 20+ zones, and you need all of them.

## The Zone Inventory

We run 25 private DNS zones. **Storage** needs 4 (blobs, files, queues, web). **Databases** needs 2 (PostgreSQL and PostgreSQL Cosmos, different zone names even though they're both Postgres. Thanks, Azure). **AI Services** needs 3 (Cognitive Services, OpenAI, Azure AI, three zones for three branding iterations of the same platform. I'm not bitter). **Container Apps** needs 4, one per region, because Container Apps zones are regional unlike every other service. Consistency is not Azure's strongest feature. Plus **Caching**, **API Management**, **Key Vault**, **Service Bus**, and more.

If you forget one zone, the corresponding private endpoints won't resolve. Terraform apply will succeed, your private endpoint will be created, and your app will silently fail. No error. Just a timeout.

## The Resolution Chain: Hub DNS Resolvers

Here's the trick that makes this work across hub-and-spoke. DNS zones are linked to the **hub VNets**, not to every spoke individually. Spokes resolve DNS through a **DNS resolver** in the hub.

```
App in spoke VNet
  → Default Azure DNS
    → Forwarded to Hub DNS Resolver (inbound endpoint)
      → Hub checks Private DNS Zones
        → Found? Returns private IP
        → Not found? Forwards to Azure public DNS
```

![DNS Resolution Chain](/assets/images/posts/dns-resolution-chain.svg)

Each hub has a DNS resolver with an **inbound endpoint** (receives queries from spokes) and an **outbound endpoint** (forwards what the hub can't resolve). Create each zone once, link it to the hub VNets, and every spoke in every region can resolve private endpoints. No per-spoke DNS management.

"What if I add a new hub?" => The DNS module auto-discovers hub VNets by naming pattern and creates links. Deploy a new hub, run the DNS deployment, zones get linked. Done.

## Common DNS Failures

**"My app can't resolve the private endpoint."** Walk the chain backwards: Does the zone exist? Is it linked to the hub VNet? Is the DNS resolver running? Is the spoke peered to the hub? 90% of the time it's the last one, a tag issue broke the peering and DNS queries never reach the hub resolver. You'll feel both relieved and slightly angry that it was a capitalization issue.

**"It resolved yesterday but not today."** Check if someone redeployed hub or DNS. Terraform might have recreated a VNet link (Azure treats some link properties as immutable). During recreation, there's a brief window where the zone isn't linked.

**"I added a new service but private endpoints don't resolve."** You probably need a new DNS zone. Check if the service type has a `privatelink.*` zone in the Azure docs. If it's not in your `dns-global.tfvars`, add it. One-line change.

## The Bottom Line

DNS is the invisible layer that makes private networking work. Every private endpoint needs a zone. Every zone needs a VNet link. Every VNet link needs a peered spoke. Any broken link in the chain results in the same symptom: silence. The most frustrating kind of failure is the one that doesn't tell you it's failing.

Set up the zones. Set up the resolvers. And when something doesn't connect, always check DNS first. It's always DNS. The answer to "why isn't this working?" is DNS about 80% of the time. The other 20% is also DNS, but with extra steps.

For a deeper look at the resolver itself, see [DNS Resolvers Without VMs](/blog/2026/03/11/the-dns-resolver-nobody-told-you-about/).

Until then, go count your private DNS zones. If the number doesn't match the number of service types you use with private endpoints... that's your bug right there >.<

---

*This is part 4 of the Azure Networking series. Previous: [Security Rules Your Developers Can't Delete](/blog/2026/03/11/security-rules-your-developers-cant-delete/). Next: [DNS Resolvers Without VMs](/blog/2026/03/11/the-dns-resolver-nobody-told-you-about/).*
