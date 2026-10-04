# 2026-10-04 — web-analytics: Web Analytics, dashboard link and address changes

Implemented v2 of the extension on `feat/web-analytics` in
`/home/goat/picode-cloudflare-pages-analytics` (worktree; `main` untouched):
Web Analytics from the publish form and Site settings with a View analytics
CTA (`https://dash.cloudflare.com/{account}/web-analytics/overview?siteTag~in={tag}`),
plus Change address (publish current version to a new project, verify, swap
records, remove the old project).

Investigation earlier today on the real dashboard established: the Pages
rename control does not change hostnames; delete already existed in v1;
enabling analytics is `POST /rum/site_info` (hostname-adopted) plus
`PATCH pages/projects` `build_config.web_analytics_tag/token`; the analytics
URL needs the `site_tag`. Token needs Account Settings Read/Write for RUM;
`checkConnection` now reports that capability.

Migration 004 adds `publications.analytics_tag`, `operations.analytics` and
`operations.progress`. Uncertain-effect discipline follows the v1 pattern:
hostname adoption instead of repeated RUM creates, holds for lost/failed
old-project deletes (never repeated; settle by absence), foreign analytics
configurations refused, restricted sites refuse address changes.

Verified: `npm ci`, `npm run build`, `npm test` — 64/64 (48 prior tests
unchanged). Removal now disposes the analytics entry; `dispose` clears the
recorded tag only when it still matches.

Scratch browser QA (2026-10-04) passed on desktop light/dark with the real
process relay and owner confirmation, using a temporary in-memory simulator
(removed with the scratch). It found and fixed two release defects: the
publish form never sent the analytics choice, and the address editor's submit
stayed disabled while typing. Mobile 360px renders correctly; driving mobile
interaction was blocked by the mobile shell not routing synthetic input into
the sandboxed iframe (host-side; same page code as the verified desktop path).

Real-account pilot (2026-10-04, owner token, disposable artifact, cleaned up):
publish with analytics served the injected beacon; the dashboard link resolved
to the site's Web Analytics page; change address ran end to end on real
projects; remove deleted the project and the analytics entry. It caught two
real-API defects, both fixed: `per_page=100` on deployments list returns 400
(now 25 — inherited from 0.3.0), and a rename failed instead of waiting when
the new deployment was still activating (now holds in `verifying` for
tick/reconcile; regression test added). Production runs this build (DB v5 —
my analytics migration renumbered to 005 after the custom-domains package's
004 was found already applied there; that package was replaced by decision of
the owner, its data and schema preserved — reinstal the custom-domains build
to resume that pilot).

The publication motion was rebuilt on the benchmark pattern (phase dots,
deterministic per-file upload bar persisted in `operations.progress`, sliding
edge line, reduced-motion honored) after the owner rejected the old single
block sweep.

Open: the mobile shell did not route synthetic input into the sandboxed iframe
(desktop path verified; physical phone still a tracked debt); one host-side
oddity — right after the update, the extension artifact list briefly returned
a single page artifact while the owner route listed all 64; did not reproduce.

Contract probe (same day, disposable project, cleaned up): plain-host
`POST /rum/site_info` returns tag/token; `PATCH build_config` stores both; the
deployment created after enabling serves the injected `beacon.min.js`; `null`
clears and reads back; injection is per-deployment, so a disabled site keeps
reporting until republished; `DELETE /rum/site_info/{tag}` matches the
extension's dispose.

Restricted real pilot (same day, disposable artifact + a kept playbook site,
cleaned up where disposable): One-time PIN enabled (the new Cloudflare One IA
keeps IdPs under Reusable components → Identity providers; the extension check
correctly refused until it was added). Restricted publish created the Access
app, held `unknown` until edge propagation (~2 min), then completed with
protection verified before upload — real 302s on root and wildcard confirmed
by curl. Reader change updated policy and revoked sessions; public change
(danger) removed the app and confirmed anonymous 200; remove cleaned Access
state (`access_app=null`). The interactive OTP login was then confirmed end to
end by the owner on a kept restricted playbook site (code by e-mail → content).
Custom domains remain unexercised. Production runs 0.4.1 from main; the
custom-domains pilot package was replaced on the owner's decision (schema and
data preserved).
