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

## GUI v2 browser evidence

Scratch QA on 2026-10-03 used the real PiCode host, process relay and owner
confirmation with a test-only Cloudflare adapter. Desktop configuration at
1366×768 kept fields and Save above the fold; switching to Access retained
unsaved values. Mobile 360px light/dark views covered configuration and
publication confirmations. Publish v1, update v2, restore v1 and remove passed;
progress remained visible and removed sites had no dead URL actions. Screenshot
review and settled host overlay audits passed. Remote provider calls were
simulated; this does not establish production Cloudflare acceptance.

## Open acceptance

- Real Cloudflare account: publish/update/restore/remove and verify all known URLs.
- Native Windows/WebView2 and a physical phone.
- A chosen name with lost creation response stays held; no UI release is provided
  by this version. Manual review and a recovery procedure are still needed.

Disabling, uninstalling and local artifact deletion never implicitly delete
remote resources. Backups restore local history; they do not undo remote effects.

## GUI v2 connection decision table

| Conditions | Action/status | Evidence |
|---|---|---|
| Account/token missing | Configure connection; check has no remote call | `test/connection.test.mjs` |
| Credentials saved, no current check | Check connection; unchecked | `test/connection.test.mjs` |
| Account project-list read succeeds | Account access verified; no write-permission claim | `test/connection.test.mjs` |
| Credentials rotated | Invalidate previous check | `test/connection.test.mjs` |
| Provider denies access or response is invalid | Sanitized error; Edit connection | `test/connection.test.mjs` |
| Instance off/process unavailable | Error and settings action; no persistent skeleton | browser QA |
| Lost remote operation response | Check result; never duplicate an effect | existing lifecycle tests |

GUI ownership and documentary adaptations: VS Code extension settings, Netlify
Drop's input-to-URL path, Cloudflare Direct Upload, Vercel per-site deployment
history, and PiCode's existing Cursor density/tokens. The owner-approved proposal
is PiCode artifact `cloudflare-pages-gui-v2-benchmar-4b209f`.
