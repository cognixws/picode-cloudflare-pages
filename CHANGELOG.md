# Changelog

## 0.4.1

- Removed sites stay hidden behind a "Show removed" toggle and render muted.

## 0.4.0

- Add Web Analytics: enabled from the publish form or Site settings, with a View analytics link into the project's dashboard analytics.
- Add Change address: publish the current version to a new project name, verify it, then retire the old address and its deployment URLs.
- The connection check reports Web Analytics capability; it needs Account Settings Read and Write on the token.
- Removal now also deletes the site's Web Analytics entry; a lost delete holds with Check result.

## 0.3.0

- Add Public and Restricted by exact email, using Cloudflare Access and email codes.
- Protect production, previews/aliases and custom domains before upload; verify policies and anonymous access.
- Change readers independently of artifact versions, revoke sessions, preserve access on updates/restores and confirm Public changes explicitly.
- Keep existing sites Public on upgrade; hold uncertain Access effects without repeating writes.


## 0.2.1

- Use Cloudflare’s official application icon in the extension and as the Publications favicon.

## 0.2.0

- Organize publishing around the selected artifact, public version and site history.
- Add an explicit account-access check; saved settings no longer imply a verified connection.
- Preserve operation progress and recovery, and remove dead links after site removal.
- Keep setup and error states actionable on desktop and mobile.

Validation: 19 automated tests and scratch browser lifecycle QA with a simulated
Cloudflare provider. Production Cloudflare and native-device acceptance remain open.
