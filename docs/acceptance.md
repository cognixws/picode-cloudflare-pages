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

## Web Analytics decision table (0.4.0)

| Conditions | Action | Evidence |
|---|---|---|
| Publish with analytics (UI default) | RUM site ensured by hostname, project analytics written, tag recorded, dashboard link exposed | `test/analytics.test.mjs` |
| Update without an explicit choice | Preserve current analytics | `test/analytics.test.mjs` |
| Explicit off during publish | Clear project configuration and recorded tag | `test/analytics.test.mjs` |
| Site-only analytics toggle | Owner-confirmed, no deployment, idempotent when unchanged | `test/analytics.test.mjs` |
| Analytics configured outside the extension | Refuse; never overwrite | `test/analytics.test.mjs` |
| Lost RUM create response | Adopt by hostname; never create twice | `test/analytics.test.mjs` |
| Token lacks Account Settings | Connection reports unavailable with a sanitized message | `test/connection.test.mjs` |
| Remove site | Analytics entry deleted; lost delete holds, Check result settles by absence | `test/analytics.test.mjs` |
| Real account, disposable project (probe 2026-10-04) | Plain-host RUM create returns tag/token; PATCH stores both; beacon injected into the deployment created after enabling; `null` clears; injection is per-deployment (clearing leaves the current publication reporting until republished); `DELETE /rum/site_info/{tag}` works as `dispose` uses it | browser session probe, this date |
| Dashboard visit counts and an extension-driven real pilot | Still open | acceptance debt |

## Address change decision table (0.4.0)

| Conditions | Action | Evidence |
|---|---|---|
| Public published site, free new name | Publish current version to the new project, verify, swap records, remove old | `test/rename.test.mjs` |
| Restricted site or uncertain Access state | Refuse before any effect | `test/rename.test.mjs` |
| Name in use, invalid, or unchanged | Refuse at prepare | `test/rename.test.mjs` |
| Production version changed after review | Refuse; prepare again | `test/rename.test.mjs` |
| Lost new-project creation response | Adopt only a fresh, extension-shaped project; hold otherwise | `test/rename.test.mjs` |
| Old-project delete lost or refused | Hold; never repeat; Check result settles by absence | `test/rename.test.mjs` |
| New deployment fails | Retain the old site and record; the prepared project stays for review | `test/rename.test.mjs` |
| Real addresses, dashboards and history | Pilot 2026-10-04: change address ran on real projects (old address retired, new address live with the beacon, dashboard link resolved); long-lived dashboard history for renamed sites still unobserved | acceptance debt |

## Real pilot findings and motion rebuild (2026-10-04)

The suite passes 66 tests: the 48 from 0.3.0 unchanged, plus analytics, rename,
migration 005 and connection-capability coverage.

A real-account pilot (owner token, disposable artifact, production instance
updated from this branch) exercised publish with analytics, the dashboard link
(a live pageview load), change address and remove. It caught two defects the
mocks could not, both fixed: the deployments listing called the API with
`per_page=100`, which the real endpoint refuses with HTTP 400 (now 25), and a
rename whose new deployment was still activating failed instead of waiting in
`verifying` for tick/reconcile (regression test added). The publication motion
was rebuilt on the benchmark pattern (phase dots, determinate per-file upload
bar, sliding edge line, reduced-motion honored) after the owner rejected the
old single-block sweep; upload progress is tracked per file into the operation
row. The mobile 360px view renders the full form and card, but synthetic
input into the sandboxed iframe was not routed by the mobile shell, so mobile
interaction remains covered only by the shared desktop code path. One host-side
oddity was observed after the update (the extension artifact list briefly
returned a single page artifact while the owner route listed all 64); it did
not reproduce on retry and is recorded for the host maintainers. The pilot
site, artifact and simulator were removed; legacy sites were untouched.

## Browser evidence (0.4.0)

On 2026-10-04, scratch QA used the real PiCode host (instance `cfpages-v2`,
0.4.0 installed from the worktree package, database version 4 confirmed after
install) with the real process relay, owner-confirmation bridge and a
temporary in-memory Cloudflare simulator (persistent across process restarts;
removed with the scratch). Verified: connection check including the analytics
capability; publish with analytics on creating the RUM site and writing the
project configuration; update preserving analytics; site-only disable with the
per-deployment wording and re-enable; the View analytics dashboard link;
change address end to end (danger confirmation naming the retiring address and
deployment URLs, old project removed, new analytics adopted, history moved);
remove deleting the site and its analytics entry; removed and empty states.
Desktop light and dark passed (overlay audit ok, control heights aligned).
Two defects found and fixed in this release: the publish form did not send
the analytics choice, and the address editor's submit button stayed disabled
while typing. The mobile 360px view rendered the full form and card; mobile
interaction could not be driven because the mobile shell did not route
synthetic input into the sandboxed iframe — the page code is identical to the
verified desktop path, and physical-phone acceptance remains tracked below.
