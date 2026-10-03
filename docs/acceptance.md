# Publication decision table and acceptance

The owner approved the publication proposal on 2026-10-03 and independent
repository ownership in the follow-up refactor. Generic artifact menus, scoped
exports, instance activation and the owner-confirmation bridge belong to PiCode.
This repository owns the Cloudflare adapter, operations, history, migrations,
UI, build and lifecycle tests.

| Conditions | Action | Evidence |
|---|---|---|
| New/unchanged/update/rollback | Pin version and remote identity/history | `service.test.mjs` |
| Prepared concurrent action/decline/stale confirmation | Refuse or cancel without effect | `service.test.mjs`; owner-confirmation bridge tested in PiCode |
| Response lost on create/deploy/delete | Reconcile; no duplicate effect | `service.test.mjs` |
| Chosen project name + lost creation response | Hold for review; never adopt by name/time | `service.test.mjs` |
| Remote deployment remains uncertain | Hold; Check result only | `service.test.mjs` |
| Update fails | Retain prior publication | `service.test.mjs` |
| Domain/deployment snapshot changes | Re-prepare before deleting | `service.test.mjs` |
| Account/identity/preview target wrong | Refuse | `service.test.mjs` |
| Local source deleted | Keep remote history, allow removal | `service.test.mjs` |
| Disable/uninstall/local archive | No implicit remote effect | no upstream lifecycle deletion handler; real acceptance debt |
| Real Cloudflare production + preview URLs | Publish/update/restore/remove and verify | acceptance debt |


Run `npm ci && npm test` in this repository. The suite covers remote effects
with an injected transport, without Cloudflare credentials.

## Browser evidence

Before extraction, scratch browser QA used the real PiCode process/bridge and a
simulated provider: publish v1, update v2, restore v1, remove; empty, blocked,
error, progress, confirmations, 760px desktop and 362px phone, light/dark.
Screenshots were read in a subagent and settled overlay audits passed.
Desktop and phone artifact actions preserved the explicitly selected versions.
Computed JavaScript resources need runtime acceptance.

## Open acceptance

- Real Cloudflare account: publish/update/restore/remove and verify all known URLs.
- Native Windows/WebView2 and a physical phone.
- A chosen name with lost creation response stays held; no UI release is provided
  by this version. Manual review and a recovery procedure are still needed.

Disabling, uninstalling and local artifact deletion never implicitly delete
remote resources. Backups restore local history; they do not undo remote effects.
