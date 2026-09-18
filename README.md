# Testing Modules 1234

Unofficial **testing repository** for Synthetiq Player modules. Packages here are beta/test builds
for import into the app; nothing is certified and no media is hosted in this repository. Modules
resolve streams from third-party public sources — use them at your own discretion and check the
source's terms.

## Add this repository in Player

```text
https://github.com/Giaxina/testing-modules-1234
```

Direct index (if your build asks for the index link):

```text
https://raw.githubusercontent.com/Giaxina/testing-modules-1234/main/repository.json
```

You can also import a module ZIP directly (*Settings → Media & Sources → import*) from [`modules/`](modules/)
— choose the module ZIP, not the extracted folder.

## Current packages

| Module | Type | Version | Identity |
| --- | --- | --- | --- |
| StreamingUnity (`streamingunity-v1`) | video | `1.0.0-beta.1` | `PENDING-OWNER-ALLOCATION` (dev) |

The machine-readable index is [`repository.json`](repository.json) (schemaVersion 1, with per-package
`packageUrl` + `sha256`). `retired-packages.json` lists retired ZIP file names (kept on disk, not
offered as installable).

> Testing candidates are not certified for stable release. Expect beta-grade behaviour; read the QA
> report for this package under [`docs/`](docs/).

## Layout

```text
repository.json          repository index built from the packages (generated)
retired-packages.json    retired ZIP file names (kept for rollback)
modules/                 candidate module ZIPs (+ .sha256)
bundles/                 Testing-<N>.zip — bundle of all active packages (generated)
docs/                    QA/test reports per package version
src/<Name>/              module sources (module.json, index.js) for future edits
tools/build.cjs          rebuilds repository.json + bundle (node tools/build.cjs)
```

## Update policy

- Every change bumps `moduleVersion`; old ZIPs are **retired, not deleted** (add the file name to
  `retired-packages.json`).
- Every package carries a SHA-256 (sibling `.sha256` file and inside `repository.json`); verify after download.
- Rebuild the index with `node tools/build.cjs`, then commit and push. Old bundle ZIPs stay so cached
  indexes never hit a 404.
- No credentials, tokens or personal data belong in this repository.
