# Testing Modules 1234

Unofficial **testing repository** for [Synthetiq Player](https://hermes-agent.nousresearch.com/docs) modules.
Packages here are beta/test builds for import into the app; nothing is certified and no media is
hosted in this repository. Modules resolve streams from third-party public sources — use them at
your own discretion and check the source's terms.

## Current packages

| Module | Type | Version | Identity | SHA-256 |
| --- | --- | --- | --- | --- |
| StreamingUnity (`streamingunity-v1`) | video | `1.0.0-beta.1` | `PENDING-OWNER-ALLOCATION` (dev) | see `index.json` |

Machine-readable index: [`index.json`](index.json) · retired versions kept in [`retired-packages.json`](retired-packages.json).

## How to install

**Option A — import the ZIP directly.** In Player: *Settings → Media & Sources → import*, and pick
the module ZIP from [`modules/`](modules/) (choose the module ZIP, not the extracted folder).

**Option B — add this repository by index URL** (if your build supports repository URLs):

```text
https://raw.githubusercontent.com/Giaxina/testing-modules-1234/main/index.json
```

If your app build expects a different index schema, tell the maintainer of this repo the exact
shape it wants — the index here is a plain JSON listing of packages with `url` + `sha256` fields.

## Layout

```text
index.json               repository index (packages + hashes) — generated
retired-packages.json    older versions (kept for rollback)
modules/                 the importable module ZIPs + .sha256 files
src/<Name>/              module sources (module.json, index.js) for future edits
docs/                    test reports per package version
tools/make_index.cjs     regenerates index.json from modules/
```

## Update policy

- Every shipped change bumps `moduleVersion`; older ZIPs are **retired, not deleted**.
- Every ZIP has a SHA-256 (sibling `.sha256` file and the hash in `index.json`); verify after download.
- The index is regenerated with `node tools/make_index.cjs` after adding a package.
- No credentials, tokens or personal data belong in this repository.
