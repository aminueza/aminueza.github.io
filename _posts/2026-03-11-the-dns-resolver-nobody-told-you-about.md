---
layout: post
title: "The DNS Resolver Nobody Told You About"
date: 2026-03-11
tags: [Azure, DNS, Networking, Private Endpoints, Cloud Architecture]
description: "Azure DNS Private Resolver replaces DNS VMs entirely. How to set up inbound/outbound endpoints, forwarding rulesets, and VPN resolution in a hub-and-spoke network."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

In my last post I explained why DNS makes or breaks private endpoints. But "there's a DNS resolver in the hub" doesn't tell you much when your VPN client can't resolve `privatelink.blob.core.windows.net`. So let's open the hood.

## DNS Private Resolver: The Components

A DNS Private Resolver is a managed Azure service that lives in the hub VNet. No VMs, no Windows DNS, no BIND, no "someone has to patch the DNS server on Saturday." It has two types of endpoints:

**Inbound endpoint** receives DNS queries. It gets a private IP on a dedicated /28 subnet, and that IP is the DNS target for everything: spoke VNets, VPN clients, on-premises users. If something needs to resolve a private name, it talks to this IP.

**Outbound endpoint** sends DNS queries to forwarding rulesets or external DNS. It sits on its own /28 subnet. The outbound endpoint is what connects the resolver to the forwarding rules that decide where each query goes.

One resolver per hub. Three hubs, three resolvers, three inbound IPs. Each region resolves independently.

![DNS Resolver Components](/assets/images/posts/dns-resolver-components.svg)

## Forwarding Rulesets: The Traffic Cop

The forwarding ruleset is where the routing logic lives. It's linked to every spoke VNet in the region. When a resource in a spoke makes a DNS query, the ruleset intercepts it and decides where to send it based on domain matching.

Three categories of rules:

**Privatelink zones** forward `privatelink.*` domains to the inbound endpoint, which resolves them against Private DNS Zones linked to the hub. This is the core of private endpoint resolution.

**Custom domains** for internal stuff: `myinternal.net`, dev environments, internal APIs. Same path, resolved against custom zones in the hub.

**External overrides** for domains that should bypass private DNS and go straight to public resolution. Some Azure services need this because they shouldn't resolve through private zones.

![DNS Forwarding Rules](/assets/images/posts/dns-forwarding-rules.svg)

## The Trailing Dot That Will Ruin Your Week

Here's the gotcha that nobody puts in the tutorial. Domain names in forwarding rules **must end with a trailing dot**. This is standard DNS notation, but Azure doesn't validate it for you.

```
privatelink.blob.core.windows.net.   ← works
privatelink.blob.core.windows.net    ← silently fails to match
```

No error. No warning. The rule just... doesn't match. Your query falls through to public DNS, returns a public IP, and you spend two hours debugging network connectivity when the problem is a missing period. A single character. I've seen this happen three times now. I'm not over it.

## VPN Clients: Same Path, Same Resolution

This is the part that surprises people. VPN clients resolve DNS through the exact same path as spoke VNets. No separate DNS infrastructure, no split-horizon tricks, no "works from the VNet but not from VPN" problems.

The VPN Gateway sits in the hub. When you configure it, you set the DNS server to the inbound endpoint's private IP. That's it. VPN clients connect, get that IP as their DNS server, and from that point on, every DNS query follows the same chain:

```
VPN client → inbound endpoint → Private DNS Zones → private IP
```

This means a developer on the VPN can resolve the same `privatelink.postgres.database.azure.com` as a container running in a spoke VNet. Same zones, same records, same IPs. No "it works in Azure but not from my laptop" debugging sessions. (Well, fewer of them. I can't promise miracles.)

## Adding a New Zone: The Checklist

When you onboard a new Azure service that uses private endpoints, you need a new DNS zone. Here's what actually needs to happen:

**1. Create the Private DNS Zone.** Name follows `privatelink.<service>.<domain>`. Check [Microsoft's docs](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns) for the exact name because they're not guessable. (`privatelink.vaultcore.azure.net`? Really, Azure?)

**2. Link the zone to every hub VNet.** The inbound endpoint can only resolve records from zones linked to its VNet. Miss one hub and that entire region can't resolve the new service. Auto-registration stays **off** for privatelink zones.

**3. Add a forwarding rule in every regional ruleset.** The domain **must have the trailing dot**. Target is the regional inbound endpoint IP. I said it twice because I've debugged it twice.

**4. Verify.** Run `nslookup` from a spoke resource and from a VPN client. Both should return a private IP. If the spoke works but VPN doesn't, your VPN DNS config is pointing to the wrong IP. If neither works, check the zone link first, then the forwarding rule, then the trailing dot.

No spoke-side changes needed. The ruleset is already linked to all spoke VNets, so they pick up the new zone automatically. That's the whole point of centralizing DNS in the hub.

"Why not just use VM-based DNS?" => Because then you have to patch it, monitor it, make it HA, scale it, and SSH into it at 2 AM when "DNS is down." Azure DNS Private Resolver is managed, zone-redundant, and costs roughly one B2s VM, except it doesn't need Windows updates.

The only catch: it resolves within its own VNet's linked zones. Cross-VNet resolution requires healthy hub-and-spoke peering, which circles back to AVNM and tags from my earlier posts. The chain is always: tags correct &#8594; peering active &#8594; DNS resolves &#8594; everything works.

Go check your forwarding rules. If any domain is missing a trailing dot... well, now you know why it's not working :D
