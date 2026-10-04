# PiCode host contract

Requires PiCode's ADR-0249 generic artifact extension doors. The manifest keeps
API version 2 and ID `cloudflare-pages`. The package is instance-activated.

The process uses `PICODE_URL`, `PICODE_EXT_TOKEN`, `PICODE_EXT_PORT`,
`PICODE_EXT_PROXY_SECRET` and `PICODE_EXT_DB` supplied by the host. The Host API
is loopback-only at `/api/ext/v1`, authenticated with
`X-PiCode-Extension-Token`. Its documented doors are:

| Route | Use |
|---|---|
| GET /settings | Encrypted account/token settings, process only |
| GET /artifacts | Scoped metadata (`artifacts:read`) |
| GET /artifacts/{id} | Metadata and versions (`artifacts:read`) |
| GET /artifacts/{id}/versions/{n}/site | Static package (`artifacts:export`) |
| POST /events | Own progress invalidation (`events:publish`) |

The site JSON contains `artifactId`, `version`, `digest` and `files`; each file
has `path`, `mime`, `sha256` and base64 `data`. The process receives packages
directly rather than through the page relay. Instance-off denies artifact access.

The sandbox page uses `picode.use` for `process`, `confirm`, `events`, `context`
and `links`. Artifact context includes a host-validated `artifactId` and integer
`version`. Events invalidate persisted state without page polling.

The page prepares an operation through the process relay, then calls
`confirm.operation(id)`. PiCode reads `/operations/{id}` and draws its own
confirmation. Only the host owner endpoint adds `X-PiCode-Owner-Confirmed` to
`/__picode/confirm`. The process checks that header against the immutable
revision and revalidates remote state before an effect. Ordinary page requests
cannot supply this header.

Extension processes are trusted local programs, not sandboxed processes. The
page never receives credentials, artifact packages or direct network access.

GUI v2 uses the existing relay for POST `/connection/check` and GET `/state`.
The latter includes connection status and sanitized check messages only. The
process obtains credentials through the Host API, checks the account project
list with a GET, and keeps a private credential fingerprint in memory. A check
never creates a project or proves write permission. Original artifact/version
context continues through the existing host context; no protocol door is added.

Web Analytics and address changes use only the same process/confirmation doors.
`/prepare` accepts `analytics:boolean` on publish, action `analytics` with
`{publicationId,analytics:boolean}` and action `rename` with
`{publicationId,projectName}`. `/state` exposes a per-publication `analytics`
object with the dashboard URL and the connection check reports the analytics
capability; no new protocol door is added.

Restricted access uses only the same process/confirmation doors. POST
`/access/check` is a read-only organization/OTP/app-list check; POST
`/access/verify` with `publicationId` checks policy and anonymous site redirects.
`/prepare` accepts optional `{mode:"public"|"restricted", emails:[...]}` as `access`
for Publish, and action `access` with `publicationId` for a site-only access change.
Restore and removal cannot override access settings. The immutable owner-reviewed
revision includes desired access, domains and the current Access policy snapshot.
`/state` exposes mode, readers, verified time and sanitized setup status; tokens,
private credential fingerprints and Access resource IDs stay in the process.
