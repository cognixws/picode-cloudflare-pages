# Changelog

## 0.2.1

- Use Cloudflare’s official application icon in the extension and as the Publications favicon.

## 0.2.0

- Organize publishing around the selected artifact, public version and site history.
- Add an explicit account-access check; saved settings no longer imply a verified connection.
- Preserve operation progress and recovery, and remove dead links after site removal.
- Keep setup and error states actionable on desktop and mobile.

Validation: 19 automated tests and scratch browser lifecycle QA with a simulated
Cloudflare provider. Production Cloudflare and native-device acceptance remain open.
