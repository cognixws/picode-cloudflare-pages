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
extension database. Migrations 001 and 002 and the process/UI paths are unchanged.
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

Each site shows its last confirmed public version, URL, update choice and
history. Restore reviews a successful production deployment. Remove public
site lives under Site settings and reviews the entire dedicated project. An
uncertain result offers Check result before another operation. A blocked or
failed load ends the loading skeleton. Save settings is performed by PiCode's
generic configuration page; it does not claim a successful connection.
