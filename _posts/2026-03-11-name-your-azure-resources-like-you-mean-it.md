---
layout: post
title: "Name Your Azure Resources Like You Mean It"
date: 2026-03-11
tags: [Azure, Terraform, Cloud Architecture, DevOps, Best Practices]
description: "rg-prod-1, storage123, my-vnet. Your naming is chaos. A five-component convention that tells you what it is, who owns it, and where it lives at a glance."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

You're staring at the Azure Portal. There's a resource group called `rg-prod-1`. Inside it: `my-storage`, `vnet-main`, `nsg-default`, and `kv-secrets`. You don't know which team owns these. You don't know which application uses them. You don't know if `rg-prod-1` is actually production or if someone named it that during a demo and forgot to delete it. There are three other resource groups with equally helpful names. Good luck figuring out what to delete.

Naming conventions sound boring until you're the person trying to identify which of 400 resources belongs to which team at 2 AM during an incident. Then they sound essential.

## The Format

Five components, separated by hyphens, always in the same order:

```
{resource}-{team}-{app}-{env}-{region}
```

![Azure Naming Convention](/assets/images/posts/azure-naming-convention.svg)

**Resource type** comes first. Use Microsoft's official abbreviations: `vm`, `vnet`, `kv`, `ca`, `nsg`, `snet`, `pep`. Always first so you can immediately see what kind of resource you're looking at.

**Team** is a 2-4 character identifier. `cnct` for connectivity, `fss` for a product team, `ai` for the AI team. Defined once in a globals config, used everywhere. When you see `kv-fss-*` you instantly know which team owns it.

**Application name** for app-specific resources, or a category (`network`, `security`, `compute`, `storage`) for shared infrastructure. `ca-fss-api-prd-weu` is an API container app. `vnet-cnct-network-dev-weu` is the connectivity team's dev VNet.

**Environment** is `dev`, `stg`, `prd`, or `global`. Three characters, matches the deployment. No ambiguity about whether something is production.

**Region** is a 3-character Azure region code: `weu` (West Europe), `eus` (East US), `eau` (Australia East). Tells you where the resource lives without opening the portal.

For resources that have multiple instances (subnets, private endpoints), add a 3-digit suffix: `snet-cnct-network-dev-weu-001`.

## The One Exception

Storage accounts can't have hyphens. Azure's naming rules require alphanumeric only, max 24 characters. So you strip the hyphens and keep the same components: `stcnctstoragedevweu`. Ugly, but consistent. Everyone knows the pattern, so even without hyphens you can parse it: `st` / `cnct` / `storage` / `dev` / `weu`.

## Why This Order Matters

The resource type comes first because that's what you filter on most. Searching for "all VNets" means searching `vnet-*`. Team comes second because "all infra team resources" is `*-cnct-*`. Environment and region come last because they're the context you already know when you're working in a specific subscription.

The order is optimized for the questions you ask: "What is this?" (resource), "Who owns this?" (team), "What's it for?" (app), "Is this production?" (env), "Where is it?" (region). Left to right, most important to least important.

## What Goes in the Same Resource Group

Resources that share a lifecycle go in the same resource group. A container app, its managed identity, and its app-specific Key Vault references all deploy and delete together. They belong in one group.

Resources that have different lifecycles don't. The VNet that your container app deploys into was created months before the app and will outlive it. The VNet belongs in a networking resource group, not the app's group.

The resource group itself follows the same convention: `rg-fss-api-prd-weu`. You can tell what's inside without opening it.

## Enforcing It

A naming convention that lives in a wiki is a suggestion. A naming convention enforced in Terraform is a rule.

In practice, this means your Terraform modules construct resource names from variables. Teams don't choose names, they provide `team`, `app`, `environment`, and `region`, and the module assembles the name:

```hcl
locals {
  name_prefix = "${var.resource_type}-${var.team}-${var.app}-${var.environment}-${var.region}"
}
```

If someone tries to create a resource outside the convention, the module won't let them. No code review needed for naming because naming isn't a decision anymore. It's a formula.

Azure Policy can enforce it at the platform level too. A policy that denies resource creation if the name doesn't match the pattern `^[a-z]+-[a-z]+-[a-z]+-[a-z]+-[a-z]+` catches anything that slips through Terraform. Belt and suspenders.

## The Reference Table

Here are the abbreviations that matter most:

| Resource | Abbreviation | Example |
|---|---|---|
| Resource Group | `rg` | `rg-fss-api-prd-weu` |
| Virtual Network | `vnet` | `vnet-cnct-network-dev-weu` |
| Subnet | `snet` | `snet-cnct-network-dev-weu-001` |
| Container App | `ca` | `ca-fss-portal-prd-weu` |
| Key Vault | `kv` | `kv-fss-api-prd-weu` |
| Storage Account | `st` | `stfssapiprdweu` |
| NSG | `nsg` | `nsg-cnct-network-prd-weu` |
| Private Endpoint | `pep` | `pep-fss-portal-prd-weu-001` |
| App Insights | `appi` | `appi-fss-portal-prd-weu` |
| Service Bus | `sb` | `sb-fss-messaging-prd-weu` |
| Managed Identity | `id` | `id-fss-api-prd-weu` |
| Azure Firewall | `afw` | `afw-cnct-security-prd-weu` |
| Log Analytics | `log` | `log-cnct-monitoring-prd-weu` |

The full list follows [Microsoft's Cloud Adoption Framework](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations). When in doubt, check there first.

## The Payoff

When every resource follows the same format, you can answer questions without opening the portal. "Which team's Key Vaults are in production West Europe?" That's `kv-*-*-prd-weu`. "What resources does the FSS team own?" That's `*-fss-*`. "Is this subnet in dev or prod?" Read the name.

No spreadsheets tracking resource ownership. No "who created this?" Slack messages. No guessing whether `storage123` is safe to delete.

Go check your Azure subscriptions. If you see resources named `default`, `test`, or `my-*`... it's time for a convention :D
