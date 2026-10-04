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

## Restricted browser evidence (0.3.0)

On 2026-10-03, the visual agent read scratch screenshots at desktop 1366×768
and mobile 360×800 in light/dark. The real PiCode host/process/owner-confirmation
bridge used a test-only provider: Restricted v1, update v2 and restore v1 preserved
readers; changing one reader to two, danger-confirmed Public, Check access and
removal passed. Missing/rejected token, missing OTP, loading/error/blocked and
progress views were covered. Visual review PASS; card yes/yes/yes/no/yes and
the real host confirmation overlay audit was ok.

Evidence remains outside this repository in PiCode's
`.worktrees/artifact-listen-toolbar/var/screenshots/access-*.png`: representative
files are `access-restricted-confirm.png`, `access-published-v1.png`,
`access-mobile-update-retains-reader.png`, `access-mobile-restore-confirm.png`,
`access-change-readers-confirm.png`, `access-changed-readers.png`,
`access-public-danger-confirm.png`, `access-public-confirmed.png`,
`access-check-local-progress-final.png`, `access-remove-confirm.png` and
`access-removed-final.png`. Setup/error evidence includes
`access-missing-token.png`, `access-missing-otp.png`,
`access-error-desktop-final.png` and `access-mobile-optional-settings.png`.

`access-unknown-simulated.png` and final Check access placement used temporary
QA injection, removed after capture. The final product change added only
`data-align-row`/`data-align-wrap` attributes on two rows; the actual iframe
auditor's geometry supplement passed with editor heights 36/36px and wrapping
action heights 36/36/36px (`ok: true`). Screenshots:
`access-tagged-actions-mobile.png`, `access-tagged-editor-mobile.png` and
`access-tagged-editor-wide.png`. This mock/browser evidence establishes no real
Access login, edge propagation, native Windows/WebView2 or physical-phone
acceptance. Release/installation receipts are recorded separately.

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

## Restricted access decision table (0.3.0)

| Conditions | Action | Evidence |
|---|---|---|
| Public / old installation / optional token missing | Keep public publishing; default existing sites Public | `test/access.test.mjs`, `test/migration.test.mjs` |
| Restricted + token/organization/OTP missing | Block before remote write; settings/check action | `test/access.test.mjs` |
| Setup read succeeds | Show login configured; never certify write permission | `test/access.test.mjs` |
| Invalid/empty/oversized email list | Refuse without mutation | `test/access.test.mjs` |
| Restricted initial publish | Atomic exact-email policy before upload; root/wildcard + returned URLs verified | `test/access.test.mjs` |
| Attached custom domain | Include in confirmation, policy and anonymous checks | `test/access.test.mjs` |
| Anonymous 200/403/404 or another login organization | Hold; never certify protection or upload | `test/access.test.mjs` |
| Other Access app/path policy overlaps | Refuse; never adopt/overwrite | `test/access.test.mjs` |
| Update / Restore | Preserve readers; refuse missing/drifted restrictions | `test/access.test.mjs` |
| Reader change / revocation fails | Keep version; revoke sessions; hold until verified | `test/access.test.mjs` |
| Restricted → Public | Danger confirmation, remove only owned app, verify old URLs, no deployment | `test/access.test.mjs` |
| Lost Access create response | Hold for manual review; no duplicate app or content upload | `test/access.test.mjs` |
| Lost reader-update response | Read desired state and revoke; never repeat uncertain policy write | `test/access.test.mjs` |
| Lost Access delete + absent/present app | Settle absence / hold, never repeat delete | `test/access.test.mjs` |
| Remove restricted site + lost Pages delete | Verify project absent before first Access cleanup | `test/access.test.mjs` |
| Pages already deleted + Access cleanup returns 403 | Hold unknown/protecting; retry only Access cleanup after authorization recovers, without repeating Pages deletion | `test/access.test.mjs` |
| Remote domains/policy change after review | Refuse mutation/upload | `test/access.test.mjs` |
| Upgrade with interrupted create/deploy | Preserve correct recovery phase and history | `test/migration.test.mjs` |
| Real Access allowlisted/disallowed reader, OTP, custom domain and session revocation | Not established by mocks; real pilot pending credentials | acceptance debt |

Account permissions, OTP setup, allowed and denied login, real edge propagation
and revocation still require owner-assisted Cloudflare acceptance. Automated
anonymous redirect checks do not establish that an allowed reader can log in.
No core refactor or new host permission is required for this release.

The final suite passed 48 tests; the Access 403 cleanup recovery test covers the
post-Pages-delete uncertainty boundary separately from browser geometry QA.
