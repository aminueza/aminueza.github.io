---
layout: post
title: "Every Permission Change Is a Pull Request"
date: 2026-03-11
tags: [Azure, Terraform, RBAC, Security, DevOps]
description: "How to manage Azure RBAC through Terraform pull requests: the three-layer IaC structure, PR-based provisioning workflow, role boundary testing, rollback strategy, and SOC2-ready audit trails."
author: Amanda Souza
image: /assets/images/profile.png
toc: true
redirect_from: /blog/2026/03/11/every-permission-change-is-a-pull-request/
---

Someone just got Contributor on production. Who approved it? When does it expire? What was the justification? If you're managing RBAC through the Azure Portal, the answer to all three is "I don't know." There's no PR to review, no commit to trace, no plan output to verify. Just a click in a portal that nobody audits until the next SOC2 review finds 47 permanent role assignments with no expiration.

In my [last post](/blog/2026/03/11/rbac-as-code-six-roles-zero-portal-clicks/) I covered the six custom roles and PIM configuration. This post is about the workflow: how those roles get assigned, reviewed, tested, and revoked, all through Terraform and pull requests. No portal clicks. Everything auditable.

## The Three Layers

RBAC in Terraform separates into three layers with different lifecycles:

**Role definitions** are the custom roles themselves. What actions are allowed, what's blocked. These live in a shared module (`modules/roles/custom-roles/`) and change rarely. When they do change, it's a security-reviewed PR because you're modifying what permissions exist in your entire organization.

**PIM policies** define the activation rules per role: duration, approval requirements, MFA, notifications. These live alongside the role definitions and are set once per role. Changing a PIM policy affects every person eligible for that role, so it gets the same security review.

**Role assignments** are the mappings: this user or group gets this role on this scope. These change frequently. New hire? Add a line. Someone leaves? Remove a line. Team change? Move the assignment. All in a tfvars file, all through a PR.

![RBAC as Code Workflow](/assets/images/posts/rbac-iac-workflow.svg)

This separation matters because the blast radius is different. A role definition change affects everyone. A role assignment change affects one person. They shouldn't live in the same Terraform state, for the same reason VPN config and DNS zones shouldn't share a state (see my earlier post on state splitting).

## The Provisioning Flow

Old way: Slack message -> portal click -> hope -> no audit trail. Takes 3-5 days. Error rate: 5-10%.

New way:

1. **Request.** User or manager identifies the need
2. **PR.** Someone edits the rbac tfvars to add the assignment
3. **Plan.** CI runs `terraform plan` and posts the diff as a PR comment
4. **Review.** Security or the team lead reviews the change. Is this the right role? Right scope? Right person?
5. **Apply.** Merge triggers `terraform apply`. Assignment is created. User gets PIM eligibility

Takes under 24 hours. Error rate: under 1%. Every step is in version control.

Deprovisioning is the same flow in reverse. Remove the line, PR, plan, review, apply. Under 4 hours. And because the assignment is gone from the tfvars, it can never drift back. If someone tries to re-add it through the portal, the next Terraform apply will remove it. The code is the source of truth.

## Testing Role Definitions

"How do you test permissions?" is the question that makes most teams shrug. Here's what actually works:

**Plan validation.** Every PR runs `terraform plan`. The plan output shows exactly which role definitions are being created or modified and what permissions change. Reviewers can read the diff and see "this role gained `Microsoft.Storage/*/write`" without running anything.

**Role boundary tests.** After applying a role definition, test it. Assign the role to a test service principal and verify: can it do what it should? Can it do what it shouldn't? If Products Contributor can call `Microsoft.Authorization/roleAssignments/write`, you have a privilege escalation bug. Automate this with a script that attempts blocked operations and asserts they fail.

**Cross-role isolation.** Verify roles don't overlap dangerously. If a Reader can somehow write data through an action you forgot to exclude, tests catch it. Portal clicks don't.

## The Rollback Story

Terraform makes rollback straightforward. If a role definition change causes issues:

**Immediate.** Revert the PR. Merge the revert. Apply. The old role definition is restored. Every assignment using that role goes back to the previous permission set.

**Gradual.** If you're migrating users from built-in roles to custom roles, do it in batches. Move one team, verify for a week, move the next. The tfvars structure supports this naturally because each assignment is an independent line.

**Emergency.** Temporarily assign in the portal. But the next `terraform apply` will reconcile, so create a matching PR immediately. Portal assignments without matching Terraform show as "will be destroyed" in the plan. Free drift detection.

## What Lives Where

The file structure matters for reviewer sanity:

```
modules/roles/
  custom-roles/          ← role definitions (change rarely)
    infra-deployment.tf
    team-deployment.tf
    products-contributor.tf
    products-reader.tf
    customer-data.tf
    products-data.tf
  pim-policies/          ← activation rules (change rarely)
    infra-pim.tf
    contributor-pim.tf
    customer-data-pim.tf

environments/
  dev/rbac.tfvars        ← role assignments (change often)
  stg/rbac.tfvars
  prd/rbac.tfvars
```

Role definitions and PIM policies are in modules that change through security-reviewed PRs. Role assignments are in environment-specific tfvars that change through normal team PRs. Different review requirements, different blast radii, different files.

## The Audit Trail

Every role assignment change is a git commit with an author, a timestamp, a PR number, a reviewer, and a plan output. When the SOC2 auditor asks "who approved this production access?", you link to a PR. When they ask "when was this access revoked?", you link to another PR. When they ask "what permissions does this role include?", you link to the role definition in version control.

Compare that to "I clicked some buttons in the portal 6 months ago." The audit practically writes itself.

Go check your Azure IAM. Count the role assignments that have no expiration and no documented approval. That's your migration backlog ;)

---

*This is part 2 of the Security & Auth series. Previous: [RBAC as Code: Six Roles, Zero Portal Clicks](/blog/2026/03/11/rbac-as-code-six-roles-zero-portal-clicks/). Next: [GitHub OIDC: The Secret Is No Secret](/blog/2026/03/11/github-oidc-the-secret-is-no-secret/).*
