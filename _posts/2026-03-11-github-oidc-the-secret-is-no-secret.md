---
layout: post
title: "GitHub OIDC: The Secret Is No Secret"
date: 2026-03-11
tags: [Azure, GitHub Actions, Security, OIDC, DevOps]
description: "How to set up GitHub Actions OIDC federation with Azure to eliminate stored credentials. Step-by-step guide for federated credentials, wildcard vs specific patterns, and SOC2 compliance."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
redirect_from: /blog/2026/03/11/github-oidc-the-secret-is-no-secret/
---

You have an Azure client secret stored in your GitHub repository settings right now. It was created 18 months ago by someone who may or may not still work here. It expires in 6 months. Nobody knows when exactly because nobody put it in the calendar. When it expires, your CI/CD pipeline will fail silently on a Friday afternoon, and someone will spend 2 hours figuring out why `terraform apply` suddenly returns "unauthorized."

I know this because it happened to me. Twice.

The fix is embarrassingly simple: stop using secrets entirely. Azure and GitHub support OIDC federation, which means GitHub Actions can authenticate to Azure without any stored credentials. No secrets to rotate. No secrets to leak. No secrets at all.

## How OIDC Federation Works

When a GitHub Actions workflow runs, it can request a short-lived JWT token from GitHub's OIDC provider. That token contains claims about who's running the workflow: which repo, which branch, which environment. Azure AD (Entra ID) validates the token against a federated credential you've configured, and if the claims match, it issues an access token. The whole thing takes seconds.

![OIDC Authentication Flow](/assets/images/posts/github-oidc-azure-flow.svg)

The JWT token lives for one job and then it's gone. There's nothing to steal, nothing to rotate, nothing to expire at 3 AM on a holiday. The best secret is the one that doesn't exist.

## Setting It Up

The whole process takes about 20 minutes. After that, adding new repos takes zero to five minutes depending on your pattern choice.

**1. Create an App Registration.** One per team is usually enough. Check if your team already has one before creating a new one.

```bash
az ad app create --display-name "GitHub Workflows <TEAM NAME>"
```

**2. Create a federated credential.** This tells Azure which GitHub repos and environments are allowed to authenticate. The `subject` claim is the key part:

```bash
az ad app federated-credential create \
  --id $APP_ID \
  --parameters '{
    "name": "my-connection",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:my-org/my-repo:environment:staging",
    "audience": ["api://AzureADTokenExchange"]
  }'
```

The subject can match on **environment** (`repo:org/repo:environment:staging`), **branch** (`repo:org/repo:ref:refs/heads/main`), **tag** (`repo:org/repo:ref:refs/tags/v*`), or **pull request** (`repo:org/repo:pull_request`).

**3. Create a service principal and assign a role.**

```bash
az ad sp create --id $APP_ID
az role assignment create \
  --assignee $SP_ID \
  --role "Contributor" \
  --scope "/subscriptions/$SUBSCRIPTION_ID"
```

**4. Add three secrets to your GitHub repo.** Yes, three values still go in GitHub, but none of them are sensitive. They're just IDs:

- `AZURE_CLIENT_ID` - the app registration's application ID
- `AZURE_SUBSCRIPTION_ID` - your Azure subscription ID
- `AZURE_TENANT_ID` - your Azure AD tenant ID

No client secret. No certificate. Just IDs that are useless without the OIDC token.

## The Workflow

Two lines change in your GitHub Actions workflow. You add `id-token: write` to permissions, and you use `azure/login@v1` without a client secret:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: azure/login@v1
    with:
      client-id: ${{ secrets.AZURE_CLIENT_ID }}
      tenant-id: ${{ secrets.AZURE_TENANT_ID }}
      subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

Terraform works the same way. The `azurerm` provider picks up the credentials from the GitHub Actions context automatically. No `ARM_CLIENT_SECRET` needed:

```hcl
provider "azurerm" {
  features {}
  # Credentials come from OIDC. Nothing to configure.
}
```

## Wildcards vs. Specific Patterns

Here's where it gets interesting. The subject claim supports wildcards, and the tradeoff between convenience and security is real.

![Wildcard vs. Specific Patterns](/assets/images/posts/oidc-wildcard-vs-specific.svg)

**Wildcards** (`repo:my-org/*:environment:*`) mean one-time setup. Any repo in your org can authenticate to any environment. New repo? It just works. No infra team ticket, no waiting. But any repo in your org can authenticate, which is a wider blast radius than you might want.

**Specific patterns** (`repo:my-org/api:environment:Production*`) mean per-repo setup. Only the repos you explicitly list can deploy. Clear audit trail. Smaller blast radius. But every new repo needs a new federated credential, which means a ticket and a 5-minute wait.

My approach: **wildcards for non-production, specific patterns for production**. Dev and staging move fast, the risk is lower, and the operational overhead of per-repo credentials isn't worth it. Production gets specific patterns per application, tied to specific branches or environments. SOC2 auditors like this. Your future self will too.

You can combine both on the same app registration. Multiple federated credentials, different patterns. One for the wildcard non-prod, one specific credential per production app.

## The Gotchas

**Environment names must match exactly.** If your federated credential says `staging` and your workflow says `Staging`, it won't match. Azure evaluates subject claims as exact strings. Sound familiar? (Looking at you, AVNM Environment tag.)

**`id-token: write` is required.** Without this permission, GitHub won't issue the OIDC token. Your workflow will fail with a cryptic "AADSTS700024" error that doesn't mention permissions at all. Ask me how long I spent on that one.

**Pull request credentials are separate.** If you want PR workflows to authenticate (for `terraform plan` on PRs, for example), you need a separate federated credential with entity type `pull_request`. The environment-based one won't match PR runs.

Stop rotating secrets. Stop storing them. Let GitHub and Azure handle the handshake, and go fix something that actually matters.

Until then, go check your GitHub repo secrets. If you see `AZURE_CLIENT_SECRET` in there... you know what to do ;)

---

*This is part 3 of the Security & Auth series. Previous: [Every Permission Change Is a Pull Request](/blog/2026/03/11/every-permission-change-is-a-pull-request/). Next: [Azure DevOps Feeds Without PATs](/blog/2026/03/11/azure-devops-feeds-without-pats/).*
