# Restricted publications with Cloudflare Access

Status: owner-approved on 2026-10-03; implementation 0.3.0.
Boundary: security model and extension-owned publication/operation persistence.

## Context

Pages production, hashed deployment URLs and branch aliases are public by default.
Pages' built-in Enable access protects previews, not the production root. A label
in PiCode cannot establish privacy. Existing projects and account-wide identity
settings belong to the owner.

## Decision

The independent extension owns Public and Restricted by exact email addresses.
Restricted uses an existing Cloudflare Zero Trust organization and One-time PIN.
A separate optional encrypted API token manages Access apps/policies; the Pages
upload token and PiCode protocol remain unchanged. The extension never enables
an identity provider or rewrites organization settings.

One owned multi-host self-hosted Access application covers the production root,
`*.project.pages.dev` (hashes and aliases) and every attached custom domain. Create
it atomically with one exact-email Allow policy and only the OTP identity provider.
No Bypass/Everyone/service-token/WARP/preflight exception is accepted. An overlapping
application, including a path-specific policy, blocks the operation rather than
being adopted or overwritten.

Before upload, read back the policy and probe anonymously for the same
organization's Access login redirect on every host, including a generated wildcard
host. Before declaring publication success, check all returned deployment URLs as
well. A timeout, HTTP 200/403/404 or unrelated redirect is not protection evidence.
Cloudflare propagation can require Check result; this never bypasses verification.

Access is site configuration, independent of artifact version. Update and restore
preserve the current readers. Reader changes revoke application sessions before
success; recovery may repeat this idempotent revocation. Changing to Public uses
an explicit owner danger confirmation warning that previous URLs become public.
Delete the owned application, read back absence and verify public HTTP 200 on root,
custom domains and known deployment URLs before updating the reported mode.

Persist remote resource IDs, reviewed policy fingerprints and an attempt before
uncertain creates/deletes. Reconciliation reads desired state; never repeat an
uncertain create, policy write or delete. A lost create response without a persisted
ID stays held for manual review. External drift requires manual review. No recovery
adopts resources by name. Remove the Pages project before cleaning its Access app,
so cleanup cannot expose surviving Pages content. A separate durable operation
phase distinguishes uncertain Access changes from uncertain Pages deployments.

## Consequences

Migration 003 defaults existing sites to Public and retains identities/history and
interrupted-operation recovery. Backups and uninstall do not undo remote policies.
The owner must protect the Cloudflare account: external changes can expose a site
between explicit checks. The UI shows the last verified time, not continuous
monitoring. Previously public material cannot be made confidential retroactively.
No password gate, organization-wide mode or scheduled expiry ships in this version.

## References and adaptation

- [Pages known issues: production vs preview Access](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain).
- [Preview URLs and aliases](https://developers.cloudflare.com/pages/configuration/preview-deployments/).
- [OTP login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).
- [Exact-email policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/).
- [Multi-host application API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/).
- [Session revocation](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/revoke_tokens/).
- PiCode Cursor benchmark: dense native controls and progressive disclosure; show
  readers only for Restricted and access changes under Site settings.
- PiCode's [providers density study](https://github.com/cognixws/picode/blob/main/docs/benchmarks/2026-09-11-providers-density.md): task-specific settings and progress stay beside the site action; verified timestamps distinguish observed state from an unconfirmed result.
