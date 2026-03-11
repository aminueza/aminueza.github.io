---
layout: post
title: "One Module Names Every Resource"
date: 2026-03-11
tags: [Terraform, Azure, DevOps, Infrastructure as Code, Best Practices]
description: "Nobody should type a resource name by hand. A globals module plus CloudPosse labels generates consistent names for every resource type from four inputs."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
---

Every naming convention fails the same way. Someone writes a document. Everyone agrees on the format. Then six months later you find `rg-prod-1`, `my-keyvault`, and `storage_account_test` in your subscriptions because the convention was a document, not code. People forget. People improvise. People copy-paste from Stack Overflow.

The fix: make naming a function, not a guideline. You pass in four values, and a module outputs the correct name for every resource type. Nobody types a name. Nobody makes a decision. The module decides.

## The Two-Module Pattern

The system uses two modules working together:

**Globals** validates your inputs and creates a config object. It maps `westeurope` to `weu`, `stg` to `Staging`, adds predefined tags, and outputs a `global_config` that every module in your infrastructure consumes.

**Labels** (we use [cloudposse/label/null](https://registry.terraform.io/modules/cloudposse/label/null/)) take that config and assemble the actual resource name. One label instance per resource type, each with a different namespace prefix and delimiter.

![Globals + Labels Pipeline](/assets/images/posts/globals-label-pipeline.svg)

You provide four inputs. You get correctly named, correctly tagged resources for everything.

## The Globals Module: Full Code

The [globals module](https://github.com/aminueza/taskflow-platform/tree/main/infrastructure/terraform/modules/globals) does three things: validate inputs, map short codes to full values, and assemble a config object that every other module consumes.

**Inputs with validation** - invalid values fail at plan time, not at deploy time:

```hcl
variable "location" {
  type = string
  validation {
    condition = contains([
      "westeurope", "eastus", "australiaeast",
      "swedencentral", "southcentralus"
    ], var.location)
  }
}

variable "environment" {
  type    = string
  default = "stg"
  validation {
    condition = contains(["prd", "stg", "dev", "global", "tst"], var.environment)
  }
}
```

**Locals do the mapping** - locations to [3-char region codes](https://www.jlaundry.nz/2022/azure_region_abbreviations/), environments to full names, and tags:

```hcl
locals {
  location_acronyms = {
    "westeurope"    = "weu"
    "eastus"        = "eus"
    "australiaeast" = "eau"
    "swedencentral" = "sdc"
  }
  location_acronym = local.location_acronyms[var.location]

  fullname_environments = {
    dev = "development", stg = "staging",
    prd = "production",  tst = "testing"
  }
  full_environment = local.fullname_environments[var.environment]

  predefined_tags = {
    "Data Classification" = var.data_classification
    "Business Impact"     = var.business_impact
    "Team"                = var.team_name
    "Environment"         = local.full_environment
  }
  all_tags = merge(local.predefined_tags, var.tags)
}
```

**One output** - the `global_config` map that every module takes as a required input:

```hcl
output "global_config" {
  value = {
    location         = var.location
    location_acronym = local.location_acronym
    environment      = var.environment
    full_environment = local.full_environment
    team_acronym     = var.team_acronym
    application_name = var.application_name
    predefined_tags  = local.predefined_tags
    all_tags         = local.all_tags
  }
}
```

Every downstream module declares `variable "global_config" { nullable = false }`. You can't create a resource without passing globals through. The naming and tagging are mandatory, not optional.

## The Label Module

Here's where names get assembled. Each resource type gets its own label instance with different settings:

```hcl
module "resource_group_label" {
  source      = "cloudposse/label/null"
  version     = "0.25.0"
  namespace   = "rg"
  stage       = var.global_config.environment
  name        = "${var.global_config.team_acronym}-${var.global_config.application_name}"
  attributes  = [var.global_config.location_acronym]
  delimiter   = "-"
  label_order = ["namespace", "name", "stage", "attributes"]
  tags        = var.global_config.all_tags
  enabled     = var.resource_name == "" ? true : false
}
```

The output is `module.resource_group_label.id` = `rg-pay-api-stg-weu`. The label module handles the concatenation, the ordering, and the delimiter. You never build a name string yourself.

The `enabled` flag is the escape hatch. If someone passes a custom `resource_name`, the label module is disabled and the custom name is used instead. This handles edge cases without breaking the convention for everyone else.

## One Label Per Resource Type

The trick is that different resource types need different label configurations. Storage accounts can't have hyphens. Containers don't need a resource type prefix. Key Vaults have a 24-character limit. Each gets its own label:

```hcl
# Key Vault: same as resource group, different namespace
module "keyvault_label" {
  source    = "cloudposse/label/null"
  namespace = "kv"
  delimiter = "-"
  # ... same pattern, outputs: kv-pay-api-stg-weu
}

# Storage Account: no delimiter (Azure requirement)
module "storage_account_label" {
  source    = "cloudposse/label/null"
  namespace = "st"
  name      = "${var.global_config.team_acronym}${var.global_config.application_name}"
  delimiter = ""
  # ... outputs: stpayapistgweu
}

# Container: no namespace prefix
module "storage_container_label" {
  source    = "cloudposse/label/null"
  name      = "${var.global_config.team_acronym}-${var.global_config.application_name}"
  delimiter = "-"
  label_order = ["name", "attributes"]
  # ... outputs: pay-api-weu
}
```

Same globals, same inputs, different assembly rules. The storage account strips hyphens automatically. The container drops the resource type prefix. Every name follows the convention, but the convention adapts to Azure's per-resource-type constraints.

## Using It in Resources

Resources reference the label output directly:

```hcl
resource "azurerm_resource_group" "rg" {
  name     = module.resource_group_label.id
  location = var.global_config.location
  tags     = var.global_config.all_tags
}

resource "azurerm_key_vault" "kv" {
  name     = module.keyvault_label.id
  location = azurerm_resource_group.rg.location
  tags     = var.global_config.all_tags
}
```

No string interpolation in resource blocks. No `"rg-${var.team}-${var.app}-${var.env}-${var.region}"` scattered across 50 files. The name comes from the label. The tags come from globals. That's it.

## Multi-App Overrides

Teams with multiple applications override `application_name` while keeping everything else:

```hcl
locals {
  api_config = merge(module.globals.global_config, {
    application_name = "api"
  })
  worker_config = merge(module.globals.global_config, {
    application_name = "worker"
  })
}
```

The API module creates `rg-pay-api-stg-weu`. The worker module creates `rg-pay-worker-stg-weu`. Same team, same environment, same region, different app names. The globals module runs once, the overrides are just map merges.

## Why This Works

**Typos** fail validation at plan time. **Inconsistency** is impossible because every module reads the same `global_config`. **Forgotten tags** can't happen because `all_tags` is built into the config, not a manual step. The convention is only as strong as the code that enforces it. A wiki page is a wish. A globals module with `nullable = false` is a guarantee.

Go check your Terraform code. If you see resource names built with string interpolation instead of a label module... that's where the drift starts ;)

---

*This is part 2 of the Terraform & IaC series. Previous: [One Naming Convention to Rule 400 Resources](/blog/2026/03/11/name-your-azure-resources-like-you-mean-it/). Next: [Terraform State Is a Liability](/blog/2026/03/11/terraform-state-is-a-liability/).*
