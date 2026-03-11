---
layout: post
title: "One Naming Convention to Rule 400 Resources"
date: 2026-03-11
tags: [Azure, Terraform, Cloud Architecture, DevOps, Best Practices]
description: "A five-component Azure resource naming convention (resource-team-app-env-region) with resource group categories, Terraform enforcement via a globals module, and the full abbreviation reference."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
redirect_from: /blog/2026/03/11/one-naming-convention-to-rule-400-resources/
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

**Team** is a 2-4 character identifier. `infra` for infrastructure, `pay` for payments, `ai` for the AI team. Defined once in a globals config, used everywhere. When you see `kv-pay-*` you instantly know which team owns it.

**Application name** for app-specific resources, or a category (`network`, `security`, `compute`, `storage`) for shared infrastructure. `ca-pay-api-prd-weu` is an API container app. `vnet-infra-network-dev-weu` is the connectivity team's dev VNet.

**Environment** is `dev`, `stg`, `prd`, or `global`. Three characters, matches the deployment. No ambiguity about whether something is production.

**Region** is a 3-character [Azure region abbreviation](https://www.jlaundry.nz/2022/azure_region_abbreviations/): `weu` (West Europe), `eus` (East US), `eau` (Australia East). Tells you where the resource lives without opening the portal.

For resources that have multiple instances (subnets, private endpoints), add a 3-digit suffix: `snet-infra-network-dev-weu-001`.

## The One Exception

Storage accounts can't have hyphens. Azure's naming rules require alphanumeric only, max 24 characters. So you strip the hyphens and keep the same components: `stinfrastoragedevweu`. Ugly, but consistent. Everyone knows the pattern, so even without hyphens you can parse it: `st` / `infra` / `storage` / `dev` / `weu`.

## Why This Order Matters

The resource type comes first because that's what you filter on most. Searching for "all VNets" means searching `vnet-*`. Team comes second because "all infra team resources" is `*-infra-*`. Environment and region come last because they're the context you already know when you're working in a specific subscription.

Left to right: "What is this?" -> "Who owns it?" -> "What's it for?" -> "Is this prod?" -> "Where?" Most important to least important.

## Resource Group Categories

Resources are grouped by **function**, not by application. A VNet and an NSG both do networking, so they go in the same group. A Container App and the VNet it runs on have different lifecycles and different owners, so they go in different groups.

The categories:

| Category | What goes in it | Example group |
|---|---|---|
| **Network** | VNets, subnets, NSGs, DNS | `rg-infra-network-dev-weu` |
| **Security** | Firewall, App Gateway, Bastion, Front Door | `rg-infra-security-prd-weu` |
| **Storage** | Storage accounts, SQL, Cosmos, PostgreSQL | `rg-pay-storage-prd-weu` |
| **Compute** | VMs, VM Scale Sets | `rg-ops-compute-dev-weu` |
| **Application** | Container Apps, App Service, Functions, AKS | `rg-pay-checkout-prd-weu` |
| **Monitoring** | Log Analytics, App Insights, Monitor | `rg-infra-monitoring-prd-weu` |
| **Messaging** | Service Bus, Event Grid | `rg-pay-messaging-prd-weu` |
| **Governance** | Azure Policies, management resources | `rg-infra-governance-global-weu` |

Notice that **Application** groups use the app name (`checkout`, `portal`, `api`) instead of the category word. That's because applications are the thing that change most often. A Container App, its managed identity, and its app-specific config all deploy and delete together. They share a lifecycle, so they share a group.

Infrastructure resources don't. The VNet that your container app runs on was created months before the app and will outlive it. The VNet belongs in `rg-infra-network-*`, not `rg-pay-checkout-*`. Different lifecycles, different groups, different blast radii.

## Enforcing It: The Globals Module

A naming convention that lives in a wiki is a suggestion. A naming convention enforced in Terraform is a rule.

The trick is a **[globals module](https://github.com/aminueza/taskflow-platform/tree/main/infrastructure/terraform/modules/globals)** that every other module depends on (I wrote a [deep dive on how it works](/blog/2026/03/11/one-module-names-every-resource/)). Teams don't pick resource names. They provide `location`, `environment`, `team_acronym`, and `application_name`. The globals module validates the inputs, maps locations to region codes (`westeurope` -> `weu`), maps environments to full names (`stg` -> `Staging`), and outputs a `global_config` object that every downstream module consumes:

```hcl
module "globals" {
  source           = "./modules/globals"
  location         = "westeurope"
  environment      = "stg"
  application_name = "checkout"
  team_acronym     = "pay"
}
```

Every module that creates resources takes `global_config` as a required input and constructs names from it. `ca-${global_config.team_acronym}-${global_config.application_name}-${global_config.environment}-${global_config.location_acronym}` becomes `ca-pay-checkout-stg-weu`. No decisions. Just a formula.

The module also enforces **validation at plan time**. Invalid locations, environments, or team acronyms fail the plan before anything touches Azure. And it attaches predefined tags (environment, region, team, data classification, business impact) to every resource automatically. No "forgot to tag" situations.

For multi-app environments, teams override `application_name` per module while keeping everything else consistent:

```hcl
locals {
  api_config = merge(module.globals.global_config, {
    application_name = "api"
  })
}
```

Azure Policy adds a second layer: deny resource creation if the name doesn't match the pattern. Belt and suspenders.

## The Reference Table

Common abbreviations: `rg`, `vnet`, `snet`, `ca`, `kv`, `st`, `nsg`, `pep`, `appi`, `sb`, `id`, `afw`, `log`. Full list in [Microsoft's Cloud Adoption Framework](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations).

## The Payoff

When every resource follows the same format, you can answer questions without opening the portal. "Which team's Key Vaults are in production West Europe?" That's `kv-*-*-prd-weu`. "What resources does the payments team own?" That's `*-pay-*`. "Is this subnet in dev or prod?" Read the name.

No spreadsheets tracking resource ownership. No "who created this?" Slack messages. No guessing whether `storage123` is safe to delete.

Go check your Azure subscriptions. If you see resources named `default`, `test`, or `my-*`... it's time for a convention :D

---

*This is part 1 of the Terraform & IaC series. Next: [One Module Names Every Resource](/blog/2026/03/11/one-module-names-every-resource/) shows the full globals + labels code.*
