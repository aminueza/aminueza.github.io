---
layout: post
title: "RBAC as Code: Six Roles, Zero Portal Clicks"
date: 2026-03-11
tags: [Azure, RBAC, Security, Terraform, PIM]
description: "How to replace Azure portal RBAC with six Terraform-managed custom roles and PIM. Covers infrastructure, team deployment, contributor, reader, customer data, and products data roles."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
redirect_from: /blog/2026/03/11/stop-clicking-buttons-to-manage-azure-permissions/
series: "Security & Auth"
series_part: 1
---

Someone needs access to production. They message you on Slack. You open the Azure Portal. You click through IAM. You search for the right subscription. You assign Contributor because you're not sure what permissions they actually need and Contributor works. You forget to set an expiration. Three months later, they still have production access. They changed teams two months ago.

This is how RBAC works at most companies. Manual portal clicks, inconsistent permissions, no expiration, no audit trail, and a growing pile of role assignments that nobody can explain. The provisioning takes 3-5 days. The deprovisioning takes "whenever someone remembers."

The fix: six custom roles at management group scope, PIM for elevated access, all managed in Terraform. No portal clicks. No guessing.

## The Six Roles

Every role is defined as a Terraform `azurerm_role_definition` at the management group level. Management group scope means the role exists once and is available in every subscription underneath. No per-subscription role definitions. No drift.

![RBAC Custom Roles Matrix](/assets/images/posts/rbac-role-matrix.svg)

**Infrastructure Deployment** is the god role. `actions: *`, `data_actions: *`. No restrictions. This is for CI/CD pipelines that manage the platform itself: VNets, AVNM, DNS, firewalls. Only service principals use this, never humans. PIM requires approval and justification, but no MFA (because you can't prompt a pipeline for a second factor).

**Team App Deployment** is almost as powerful but can't escalate privileges, modify management groups, or change billing. This is for team CI/CD pipelines deploying applications. Same PIM model: approval required, no MFA.

**Products Contributor** is the developer role for production. `actions: *` minus authorization writes (can't change who has access) and billing. Developers can create, modify, and delete resources, manage secrets, deploy apps. They can't grant themselves more permissions. PIM is 4 hours, no approval required (because the on-call person at 3 AM can't wait for a manager to approve), but MFA is mandatory.

"Why no approval for production Contributor?" => Because on-call efficiency matters more than approval theater. If someone needs to restart a service at 3 AM, requiring manager approval defeats the purpose of having on-call. Justification is still required, so every activation is logged with a reason, but the activation is instant.

**Products Reader** is read-only. View resources, read secrets, read certificates. No write access. No PIM required because reading things isn't dangerous. This is for support teams, analysts, and anyone who needs to look but not touch.

**Customer Data** is the sensitive one. Read-only access to storage, databases, and caches that contain customer information. Strictest PIM: 2-hour activation, approval required, MFA required, justification required, and both security and compliance teams are notified on every activation. This is the role your SOC2 auditor cares about most.

**Products Data** is the same as Products Contributor but explicitly includes all data actions. For developers who need to read and write application data (not customer data) in databases, storage, and caches. PIM is 4 hours with MFA but no approval.

## The PIM Model

Privileged Identity Management turns permanent role assignments into just-in-time access. Instead of "you always have Contributor on production," it becomes "you're eligible for Contributor on production, activate it when you need it, it expires in 4 hours."

The PIM configuration per role is the part most teams get wrong. Three rules:

**Pipeline roles don't get MFA.** You can't prompt a CI runner for a second factor. Approval and justification, yes. MFA, no.

**On-call roles don't get approval.** Requiring a manager to wake up and click "approve" at 3 AM is worse than no PIM. Justification is captured, team is notified, but activation is instant.

**Customer data always gets everything.** Approval, MFA, justification, ticket, and notifications to security and compliance. Friction is a feature here.

## Why Custom Roles?

"Why not just use built-in Contributor and Reader?" => Because built-in Contributor includes `Microsoft.Authorization/*/Write`, which means anyone with Contributor can grant themselves Owner. That's privilege escalation, and it's the first thing an auditor flags.

Custom roles let you define exactly what's allowed and what's blocked. The `not_actions` list is short and specific:

```hcl
not_actions = [
  "Microsoft.Authorization/*/Delete",
  "Microsoft.Authorization/*/Write",
  "Microsoft.Authorization/elevateAccess/Action",
  "Microsoft.Management/managementGroups/*",
  "Microsoft.Billing/*",
]
```

Five exclusions. No privilege escalation, no management group changes, no billing modifications. Everything else is allowed. This is dramatically better than built-in Contributor, and it's auditable because the role definition is in version control.

## The Provisioning Flow

Old way: Slack message -> portal clicking -> hope someone remembers to set expiration -> no audit trail.

New way: User requests access through an access management portal. For roles that require approval, the manager approves. Terraform applies the eligible role assignment. The user activates via PIM when they need it. The activation expires automatically. Every step is logged.

Provisioning: under 24 hours (vs 3-5 days). Deprovisioning: under 4 hours (vs 1-2 days). Error rate: under 1% (vs 5-10% when humans click buttons in portals).

## The Tradeoffs

Teams share role definitions. "Products Contributor" has the same permissions regardless of team, because `not_actions` is about governance boundaries, not functional ones. If a team needs something genuinely different, create a team-specific role. So far, shared works.

The other tradeoff: everything goes through Terraform. No quick portal fixes. This is annoying once a month and prevents security incidents the rest of the time.

Go check your Azure IAM assignments. If you see permanent Contributor roles on production subscriptions with no expiration... you know what to do ;)

---

*This is part 1 of the Security & Auth series. Next: [Every Permission Change Is a Pull Request](/blog/2026/03/11/every-permission-change-is-a-pull-request/) covers the IaC workflow for managing these roles.*
