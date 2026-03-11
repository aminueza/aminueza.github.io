---
layout: post
title: "Azure DevOps Feeds Without PATs"
date: 2026-03-11
tags: [Azure, GitHub Actions, DevOps, OIDC, CI/CD]
description: "How to authenticate GitHub Actions with Azure DevOps Artifacts feeds using OIDC instead of PATs. Covers the magic scope UUID, token exchange, and configs for pip, npm, NuGet, and Maven."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
series: "Security & Auth"
series_part: 4
---

You're building in GitHub Actions. Your private packages live in Azure DevOps Artifacts. So someone created a Personal Access Token, pasted it into a GitHub secret called `ADO_PAT`, and your pipeline has been pulling packages with it ever since. It works great until it doesn't, which is usually 90 days later when the PAT expires and your builds start failing with "401 Unauthorized" on `pip install`.

"Just rotate the PAT." => Sure, and also set a calendar reminder, and also remember which repos use it, and also hope the person who created it still has permissions to make a new one. Or... just stop using PATs entirely.

If you read my [last post on OIDC federation](/blog/2026/03/11/github-oidc-the-secret-is-no-secret/), you already have passwordless authentication between GitHub Actions and Azure. The trick is extending that to Azure DevOps Artifacts. And it's all about one magic scope that nobody tells you about.

## The Magic Scope

After your GitHub Actions workflow logs into Azure via OIDC, you can exchange that session for an Azure DevOps-scoped access token. The command is one line, but the scope is a UUID that you will never, ever guess:

```bash
az account get-access-token \
  --scope 499b84ac-1321-427f-aa17-267ca6975798/.default \
  --query accessToken -o tsv
```

`499b84ac-1321-427f-aa17-267ca6975798` is the resource ID for Azure DevOps Services. The `/.default` suffix grants whatever permissions your service principal has. That's it. This one command gives you a token that works with every Artifacts feed your service principal can access.

![Azure DevOps Feed Authentication Flow](/assets/images/posts/ado-feed-auth-flow.svg)

## The Workflow

Your workflow needs two steps: OIDC login (which you already have from the previous post), and the token exchange:

```yaml
- name: Azure Login
  uses: azure/login@v2
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- name: Get DevOps Feed Token
  id: feed_token
  run: |
    token=$(az account get-access-token \
      --scope 499b84ac-1321-427f-aa17-267ca6975798/.default \
      --query accessToken -o tsv)
    echo "ADO_TOKEN=$token" >> $GITHUB_OUTPUT
```

From here, every package manager uses the token the same way: username `az`, password is the token. That's the pattern for all of them.

## Every Package Manager in 30 Seconds

**Python (pip):**
```yaml
- run: pip install -r requirements.txt
  env:
    PIP_EXTRA_INDEX_URL: "https://az:${{ steps.feed_token.outputs.ADO_TOKEN }}@pkgs.dev.azure.com/YOUR_ORG/_packaging/YOUR_FEED/pypi/simple/"
```

**Node (npm):** Configure the registry and base64-encode the token:
```yaml
- run: |
    npm config set @your-scope:registry https://pkgs.dev.azure.com/YOUR_ORG/_packaging/YOUR_FEED/npm/registry/
    npm config set //pkgs.dev.azure.com/YOUR_ORG/_packaging/YOUR_FEED/npm/registry/:_password $(echo -n "${{ steps.feed_token.outputs.ADO_TOKEN }}" | base64)
    npm config set //pkgs.dev.azure.com/YOUR_ORG/_packaging/YOUR_FEED/npm/registry/:username az
    npm install
```

**.NET (NuGet):**
```yaml
- run: |
    dotnet nuget add source "https://pkgs.dev.azure.com/YOUR_ORG/_packaging/YOUR_FEED/nuget/v3/index.json" \
      --name Feed --username az \
      --password "${{ steps.feed_token.outputs.ADO_TOKEN }}" \
      --store-password-in-clear-text
    dotnet restore
```

**Java (Maven):** Write a `settings.xml`:
```yaml
- run: |
    mkdir -p ~/.m2
    cat > ~/.m2/settings.xml << 'EOF'
    <settings><servers><server>
      <id>azure-feed</id>
      <username>az</username>
      <password>${{ steps.feed_token.outputs.ADO_TOKEN }}</password>
    </server></servers></settings>
    EOF
    mvn clean install
```

Same pattern, four languages, zero stored secrets.

## Permissions: Feed Reader vs. Contributor

Your service principal needs explicit permissions on the feed. Azure DevOps doesn't inherit this from Azure roles. You need to:

1. Create a group in Azure DevOps (e.g., "GitHub Feed Readers")
2. Add your AAD application to that group
3. In the feed settings, grant that group **Feed Reader** (for consuming) or **Feed Contributor** (for publishing)

If your pipeline can log in but gets "403 Forbidden" on package install, this is almost always why. The Azure login worked, the token exchange worked, but the service principal doesn't have feed-level permissions. Azure DevOps permissions and Azure RBAC are separate worlds.

## Publishing Packages

Publishing works the same way, just with Feed Contributor permissions. For NuGet:

```bash
dotnet nuget push *.nupkg --source Feed --api-key az
```

For Python:

```bash
TWINE_USERNAME=az TWINE_PASSWORD=$ADO_TOKEN \
  twine upload --repository-url \
  "https://pkgs.dev.azure.com/YOUR_ORG/_packaging/YOUR_FEED/pypi/upload/" dist/*
```

The `api-key` and `username` values are ignored by Azure DevOps. It only looks at the token. But the CLI tools require them, so `az` it is.

## Local Development

Developers can use the same flow locally. Instead of OIDC, they just `az login` with their own account and run the same `get-access-token` command:

```bash
az login
token=$(az account get-access-token \
  --scope 499b84ac-1321-427f-aa17-267ca6975798/.default \
  --query accessToken -o tsv)
```

Then configure their package manager with the token. It works for pip, npm, NuGet, Maven, all of them. The token expires in about an hour, but for local development that's usually enough. Beats managing PATs in `.npmrc` files that accidentally get committed. (Don't pretend it hasn't happened.)

## The Gotchas

**The scope UUID is not optional.** If you use a different scope or forget it, you'll get a token that authenticates to Azure but not to DevOps. The error will say "unauthorized" and you'll blame your permissions when the real problem is the token scope.

**`--store-password-in-clear-text` is required for NuGet on Linux.** NuGet's credential store isn't available on Linux runners. This flag looks scary but it only affects the ephemeral runner filesystem. The token dies with the job.

**npm needs base64-encoded passwords.** Don't pass the token directly. Pipe it through `echo -n "$TOKEN" | base64`. Without base64, npm silently fails authentication. No error. Just 401. Lovely.

Go check your GitHub secrets. If you see `ADO_PAT` in there, now you know the alternative ;)

---

*This is part 4 of the Security & Auth series. Previous: [GitHub OIDC: The Secret Is No Secret](/blog/2026/03/11/github-oidc-the-secret-is-no-secret/). Start from [part 1](/blog/2026/03/11/rbac-as-code-six-roles-zero-portal-clicks/).*
