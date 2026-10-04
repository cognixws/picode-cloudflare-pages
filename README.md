# Cloudflare Pages extension

An independently maintained [PiCode](https://github.com/cognixws/picode) extension
for static artifact versions. Requires PiCode
with ADR-0249 and Node.js 24 (built-in SQLite). In PiCode, open **Extensions → Install extension**, paste
`https://github.com/cognixws/picode-cloudflare-pages`, review and install; no npm install or build runs during installation. Open Configuration, enter account ID and an API token with Cloudflare Pages Edit,
and save. Open Publications and choose Check connection. The read-only account
check verifies project-list access, not write permission. Then open an artifact's
Actions → Publish to Cloudflare Pages; its exact version is selected. A custom
project name is optional under Advanced options.

The owner chooses a version and optionally a project name. Every artifact gets
one dedicated Direct Upload project. The extension never attaches an existing
project. Updates preserve its URL; successful production versions can be
restored. Remove reviews domains and deployment URLs before deleting the whole
project. Artifacts, disable/uninstall and backups do not implicitly delete sites.

Secrets stay in PiCode's encrypted settings; the sandboxed page has no token
or network. The process sends Cloudflare requests, owns its SQLite history and
reconciles uncertain operations after restart. Check result does not duplicate
an uncertain deployment/delete. A chosen project name stays held for manual
Cloudflare review if its creation response is lost; only generated names can
be reconciled without a persisted remote identity. Prepared operations can be
cancelled.

Only independent HTML pages are supported initially. Declared PiCode
capabilities require a separately published independent version. The portable
package includes assets, public local libraries, an offline bridge shim and
restrictive headers. Computed resource references need browser acceptance.

## Development

```sh
npm ci
npm run build
npm test
```

Build and test from this repository. Development dependencies are locked in
`package-lock.json`; no PiCode checkout, sibling folder or private host import is
needed. The build bundles Zod (MIT) into the committed `ui/app.js`. Zod is
justified by PiCode's form validation contract. The installed process needs only
Node.js 24 and the shipped files; npm is not required on the PiCode server.

`vendor/blake3-wasm` is the minimal Node distribution of blake3-wasm 2.1.5
(MIT; LICENSE included), needed to match Wrangler's Pages asset hashes.
Verified npm tarball integrity:
`sha512-F1+K8EbfOZE49dtoPtmxUQrpXaBIl3ICvasLh+nJta0xkz+9kF/7uet9fLnwKqhDrmj6g+6K3Tw9yQPUg2ka5g==`.
Source: https://registry.npmjs.org/blake3-wasm/-/blake3-wasm-2.1.5.tgz.
No dependency installation occurs on process start.

The [decision table](docs/acceptance.md) distinguishes
simulated API/browser evidence from a real account pilot. Cloudflare currently
recommends Workers for new projects; this owner-approved implementation targets
Pages and keeps its adapter separate.

## Host contract and upgrades

The extension calls only the versioned Host API and sandbox bridge documented in
[docs/host-api.md](docs/host-api.md). The ID remains `cloudflare-pages`; replacing
the package source preserves PiCode enablement, settings, secrets and the
extension database. Migrations 001 and 002 and the process/UI paths are unchanged; migration 003 adds access state.
A PiCode release supporting ADR-0249 is required before installation.

## License

Apache-2.0, matching the other CognixWS PiCode extensions. Third-party MIT notices
are retained under `vendor/`.

## GUI v2

The connection notice distinguishes missing settings, unchecked settings,
verified account access and rejected credentials. The check is a GET to the
account's Pages project list and creates no remote resources. Its result is kept
in process memory and invalidated when credentials change or the process
restarts. Tokens and their fingerprints never reach the page.

Each site shows its last confirmed version and access, URL, update choice and
history. Restore reviews a successful production deployment. Remove
site lives under Site settings and reviews the entire dedicated project. An
uncertain result offers Check result before another operation. A blocked or
failed load ends the loading skeleton. Save settings is performed by PiCode's
generic configuration page; it does not claim a successful connection.

## Icon attribution

`ui/cloudflare.png` is Cloudflare’s official application icon, downloaded from
https://dash.cloudflare.com/apple-touch-icon-152x152.png. The Cloudflare name
and logo belong to Cloudflare; the extension is independently maintained.

## Public and Restricted access (0.3.0)

Choose **Public** or **Restricted by email** in the publication form. Existing
sites default to Public. For Restricted, enter 1–50 exact email addresses; readers
sign in with an email code. **Site settings → Change access** changes readers or
makes a site public without deploying another artifact version. Update and Restore
preserve the current access settings. Making a restricted site Public requires a
danger confirmation covering previous deployment URLs. Changing readers revokes
existing sessions, so allowed readers sign in again.

To configure Restricted:

1. Set up a [Cloudflare Zero Trust organization](https://one.dash.cloudflare.com/)
   and enable **One-time PIN** in its login methods.
2. Create a separate account-scoped token with **Access: Apps and Policies Write**
   and **Access: Organizations, Identity Providers, and Groups Read**.
3. Save it in PiCode's **Cloudflare Access API token (optional)** secret setting.
   Keep the existing Pages token. Choose Restricted and **Check restricted access**.
   This check verifies organization/login reads, not write permission.

The extension protects the production root, wildcard preview/alias hostnames and
all custom domains reported by Pages, before uploading. It refuses overlapping
Access apps, policy drift and unverified protection. Propagation may leave an
operation at **Check result**; no new content is sent until protection is verified.
A lost Access creation response or uncertain delete can require manual review;
never delete protection on a surviving site to clear a held operation.

**Check access** verifies current policy and anonymous redirects, including known
previous URLs. The card shows the last check time. These are explicit checks;
external changes in Cloudflare are not monitored continuously. Content previously
published publicly may already have been copied. See the
[security decision](docs/decisions/001-restricted-publications.md) and
[acceptance table](docs/acceptance.md) for recovery and remaining real-account QA.
