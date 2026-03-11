---
layout: post
title: "Pretty URLs for Internal Apps"
date: 2026-03-11
tags: [Azure, Container Apps, DNS, Networking, Security]
description: "How to set up custom domain names for Azure Container Apps using Private DNS zones and self-signed certificates for VPN-only internal access without public internet exposure."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
redirect_from: /blog/2026/03/11/pretty-urls-for-internal-apps/
---

Your internal admin panel has a URL like `ca-platform-admin-dev-weu.happyfield-abc123.westeurope.azurecontainerapps.io`. You share it in Slack. Someone copies it wrong. Someone else bookmarks it and it stops working after a redeployment. Nobody can remember it. Nobody should have to.

Internal apps deserve real domain names. `admin.internal.mycompany.net` is memorable, stable, and doesn't change when you redeploy. The trick is doing this without exposing anything to the internet. Private DNS Zone + self-signed certificate + VPN. No public DNS. No Let's Encrypt. No external access.

## The Architecture

The setup has four moving parts:

**Private DNS Zone** (`internal.mycompany.net`) hosts the records. It's linked to your hub VNets so VPN clients and spoke resources can resolve it. Not registered anywhere public, it only exists inside your Azure network.

**DNS records** point your custom domain to the Container App Environment's private endpoint. An A record for the root, a TXT record for domain verification, and a CNAME per app.

**Self-signed certificate** stored in Key Vault. Since the domain is internal-only and accessed via VPN, you don't need a publicly trusted CA. A wildcard self-signed cert (`*.internal.mycompany.net`) covers all your apps. Your security team installs the root CA on company machines.

**Custom domain registration** on the Container App itself, pointing to the cert in Key Vault.

![Custom DNS for Container Apps](/assets/images/posts/container-apps-custom-dns.svg)

## Step 1: Create the Private DNS Zone

Create the zone and link it to your hub VNets. If you're using the hub-and-spoke architecture from my earlier posts, link it to all three hub VNets so every region can resolve it.

Auto-registration stays **off**. You don't want Azure automatically creating DNS records for every resource in the VNet. You want explicit control over what resolves to what.

If your DNS zones are managed by a separate Terraform deployment (as they should be), add the zone there. If you're doing this manually, Azure Portal works fine.

## Step 2: Configure DNS Records

Three records per application:

**A record** (`@`) pointing to the private endpoint IP of your Container App Environment. Not the app's IP, the environment's private endpoint. This is the IP that the Container App Environment's ingress controller listens on.

**TXT record** (`@`) with the Custom Domain Verification ID from your Container App Environment. Azure uses this to prove you own the domain. You find this in any container deployed to the environment under Networking -> Custom Domains.

**CNAME record** (`admin` or whatever your app is called) pointing to the app's FQDN (the ugly `happyfield-abc123.westeurope.azurecontainerapps.io` one). This tells the Container App Environment which app to route to when a request arrives for `admin.internal.mycompany.net`.

A and TXT are per environment. CNAME is per app.

## Step 3: Import the Certificate

This is the step that trips people up because it involves three things talking to each other: a managed identity, Key Vault, and the Container App Environment.

**Assign a managed identity** to your Container App Environment. The environment needs an identity that can pull certificates from Key Vault.

**Grant Key Vault access.** The managed identity needs the `Key Vault Certificate User` role on the Key Vault that holds your wildcard cert. Without this, the environment can see the Key Vault but can't read the certificate. The error message won't be helpful.

**Import the certificate** in the Container App Environment under Settings -> Certificates. Select "Bring your own certificate" and point it to the Key Vault. If the permissions are correct, it'll import and show as "Healthy." If it shows "Failed," check the managed identity and the role assignment. It's always the role assignment.

## Step 4: Register the Custom Domain

Go to your Container App -> Custom Domains -> Add. Enter your domain (`admin.internal.mycompany.net`), select the wildcard certificate you imported, and click Add. Azure validates the TXT record and CNAME, binds the domain to the app, and within a few minutes your custom domain is live.

If validation fails, check: Does the TXT record match the verification ID exactly? Does the CNAME point to the correct app FQDN? Is the DNS zone linked to the VNet where the Container App Environment lives? In my experience, it's the CNAME 60% of the time and the TXT record 40% of the time.

## Why Self-Signed?

"Why not use Let's Encrypt?" => Because Let's Encrypt needs to validate domain ownership via HTTP or DNS challenges that reach the public internet. Your domain doesn't exist on the public internet. There's nothing to validate against. A self-signed cert with the root CA installed on company machines is the correct approach for internal-only domains.

"Why not Azure managed certificates?" => They use Let's Encrypt under the hood. Same problem.

The self-signed cert lives in Key Vault, gets rotated when you update it there, and the Container App Environment picks up the new version automatically. Distributing the root CA to company machines is a one-time task for your security team.

## After Setup

Connect to VPN. Open `https://admin.internal.mycompany.net`. It works. The browser trusts the cert because the root CA is installed. DNS resolves through the hub resolver to the private DNS zone. Traffic stays inside the Azure network. No internet involved at any point.

Clean, memorable URLs. No more sharing 55-character FQDNs in Slack. And if you're using the DNS resolver setup from the [Azure Networking series](/blog/2026/02/24/your-azure-network-is-a-flat-disaster/), spoke resources can resolve these too, not just VPN clients.

Go check your internal app URLs. If you're bookmarking `happyfield-abc123.westeurope.azurecontainerapps.io`... there's a better way :D
