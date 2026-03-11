---
layout: post
title: "Terraform Remote State: The Module That Protects Itself"
date: 2026-03-11
tags: [Terraform, Azure, Security, Infrastructure as Code, DevOps]
description: "A Terraform module for secure Azure remote state: customer-managed Key Vault encryption, private endpoints, blob versioning, diagnostic logging, and OIDC authentication. Full code included."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
series: "Terraform & IaC"
series_part: 4
---

Your Terraform state file contains every resource attribute in your infrastructure. Database connection strings, Key Vault URIs, private IPs, managed identity principal IDs. If someone gets read access to your state, they have a map of your entire environment. And by default, it's sitting in a storage account with a shared access key that three people have saved in their terminal history.

I wrote a module that fixes this. Every team runs it once per subscription, and from that point on, their state is encrypted with customer-managed keys, locked behind private endpoints, and every access is logged. Here's the full thing.

## What the Module Creates

One `module "tfstate"` call produces:

**A resource group** with `prevent_destroy = true`. You can't accidentally delete your state storage with `terraform destroy`. Terraform will refuse.

**A storage account** hardened from the defaults:

```hcl
resource "azurerm_storage_account" "storage" {
  name                     = module.storage_account_label.id
  account_tier             = "Standard"
  account_replication_type = "LRS"

  identity { type = "SystemAssigned" }

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
    ip_rules       = var.ipv4_allow_list
  }

  min_tls_version                   = "TLS1_2"
  infrastructure_encryption_enabled = true
  https_traffic_only_enabled        = true
  local_user_enabled                = false
  allowed_copy_scope                = "PrivateLink"

  blob_properties {
    versioning_enabled = true
    change_feed_enabled = true

    delete_retention_policy { days = 7 }
    container_delete_retention_policy { days = 7 }
    restore_policy { days = 7 }
  }
}
```

Network rules default to **Deny**. Only your IP allowlist and Azure services can reach it. Versioning is on, so if state gets corrupted, you can restore a previous version from the Azure Portal. Blob soft delete gives you 7 days to recover accidental deletions. Point-in-time restore lets you roll back the entire container to a specific moment. `local_user_enabled = false` disables shared key auth for local users. `allowed_copy_scope = "PrivateLink"` prevents data exfiltration.

**A Key Vault** with a customer-managed encryption key:

```hcl
resource "azurerm_key_vault" "tfstate" {
  purge_protection_enabled      = true
  rbac_authorization_enabled    = true
  enabled_for_disk_encryption   = true

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = var.ipv4_allow_list
  }
}

resource "azurerm_key_vault_key" "tfstate" {
  key_type = "RSA"
  key_size = 2048
  key_opts = ["decrypt", "encrypt", "sign", "unwrapKey", "verify", "wrapKey"]
}

resource "azurerm_storage_account_customer_managed_key" "tfstate" {
  storage_account_id = azurerm_storage_account.storage.id
  key_vault_id       = azurerm_key_vault.tfstate.id
  key_name           = azurerm_key_vault_key.tfstate.name
  key_version        = null  # automatic rotation
}
```

`key_version = null` is the important bit. It enables automatic key rotation. When the key rotates in Key Vault, the storage account picks up the new version without a Terraform change. The storage account's managed identity gets `Crypto Service Encryption User` on the vault, and the deploying principal gets `Crypto Officer` to manage the key.

**Private endpoints** for both storage (blob) and Key Vault, linked to the hub's private DNS zones:

```hcl
resource "azurerm_private_endpoint" "storage_blob" {
  count     = length(var.subnet_ids) > 0 ? 1 : 0
  subnet_id = var.subnet_ids[0]

  private_service_connection {
    private_connection_resource_id = azurerm_storage_account.storage.id
    subresource_names              = ["blob"]
  }

  private_dns_zone_group {
    private_dns_zone_ids = [data.azurerm_private_dns_zone.blob_storage[0].id]
  }
}
```

Same pattern for Key Vault. The `count` is conditional on `subnet_ids` being provided, so teams without private networking can still use the module (they just get public access with IP rules instead of private endpoints).

**Diagnostic settings** on both the storage account and Key Vault, logging `StorageRead`, `StorageWrite`, `StorageDelete`, and Key Vault `AuditEvent` to Log Analytics. Every state operation is auditable.

## Using the Module

Teams call it with their [globals config](https://github.com/aminueza/taskflow-platform/tree/main/infrastructure/terraform/modules/globals) (see my [auto-naming post](/blog/2026/03/11/one-module-names-every-resource/) for the full module) and an IP allowlist:

```hcl
module "globals" {
  source           = "./modules/globals"
  location         = "westeurope"
  environment      = "stg"
  application_name = "tfstate"
  team_acronym     = "pay"
}

module "tfstate" {
  source          = "./modules/terraform-state"
  global_config   = module.globals.global_config
  ipv4_allow_list = ["YOUR_IP"]
  subnet_ids      = [module.hub.subnet_id]  # optional
}
```

That creates `rg-pay-tfstate-stg-weu`, `stpaytfstatestgweu`, `kv-pay-tfstate-stg-weu`, the encryption key, private endpoints, and diagnostic settings. One call. Every security control baked in.

## Configuring the Backend

After the module deploys, configure your backend to use it:

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-pay-tfstate-stg-weu"
    storage_account_name = "stpaytfstatestgweu"
    container_name       = "cttfstate"
    key                  = "statebucket/terraform.app.tfstate"
    use_oidc             = true
  }
}
```

`use_oidc = true` means CI/CD pipelines authenticate with the same OIDC federation from my earlier post. No storage account keys in GitHub secrets. No SAS tokens. The backend auth is passwordless.

When you run `terraform init`, Terraform asks to migrate local state to the remote backend. Type `yes`. Verify with `terraform state list`. Done.

## The Naming Convention

State file paths follow a predictable pattern:

```
statebucket/terraform.hub-global.tfstate
statebucket/terraform.dns-global.tfstate
statebucket/terraform.firewall-global.tfstate
statebucket/terraform.spokes-dev.tfstate
statebucket/terraform.spokes-prd.tfstate
```

One storage account, one container, many state files. Each split by lifecycle, as I covered in my Terraform state splitting post. The naming tells you what's inside without opening anything.

## Why Not Just Use a Storage Account?

Because a storage account with defaults is a liability. No encryption beyond Azure-managed keys (which Microsoft holds). No network restrictions. No audit logging. Shared access keys enabled. No versioning. If state gets corrupted or deleted, you're restoring from wherever your last backup was. If you have a backup. (You probably don't.)

The module turns "storage account with a blob" into "encrypted, network-isolated, audited, recoverable state storage." The difference is about 100 lines of Terraform and zero ongoing maintenance.

Go check your state storage. If your storage account has `default_action = "Allow"` in its network rules... you know what to do ;)

---

*This is part 4 of the Terraform & IaC series. Previous: [Terraform State Is a Liability](/blog/2026/03/11/terraform-state-is-a-liability/). Start from [part 1](/blog/2026/03/11/one-naming-convention-to-rule-400-resources/).*
