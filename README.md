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

You can also import a module ZIP directly (*Settings → Media & Sources → import*) — download the
ZIP from [`modules/`](modules/) (e.g. `StreamingUnityHermes-1.0.0-beta.2.zip`) and choose that file,
not the extracted folder and not the bundle.

## Current packages

| Module | Type | Module ID | Version | Identity number |
| --- | --- | --- | --- | ---: |
| StreamingUnity Hermes | video | `streamingunity-hermes-v1` | `1.0.0-beta.2` | 9004 |

The machine-readable index is [`repository.json`](repository.json) (schemaVersion 1, with per-package
`packageUrl` + `sha256`). `retired-packages.json` lists retired ZIP file names (kept on disk, not
offered as installable).

> **Identity + trust notes.** Identity number `9004` is a test-only compatibility identity, not an
> official catalogue allocation. The index is unsigned (empty signature fields), so the app installs
> this as a *community repository*: usable, but not marked trusted. This repository is not the
> official catalogue and does not claim maintainer approval.
>
> The beta.1 package (development identity `0`) failed repository install with
> `No repository modules were installed` — Player requires a positive identity number. beta.2
> renames the module to avoid the official `streamingunity-v1` (SP-VID-065) and ships identity
> `9004`. Read [`docs/`](docs/) for the reports.

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
  `retired-packages.json`). Never modify an already published version's bytes.
- Every package carries a SHA-256 (sibling `.sha256` file and inside `repository.json`); verify after download.
- Rebuild the index with `node tools/build.cjs`, then commit and push. Old bundle ZIPs stay so cached
  indexes never hit a 404.
- No credentials, tokens or personal data belong in this repository.
