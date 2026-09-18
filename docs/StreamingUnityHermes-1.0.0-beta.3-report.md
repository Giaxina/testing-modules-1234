# StreamingUnity Hermes module — test report

Module ID / name / version: `streamingunity-hermes-v1` / **StreamingUnity Hermes** / `1.0.0-beta.3`
Family / identity: `streamingunity_hermes_v1` / `SP-VID-9004-STREAMINGUNITY-HERMES-TEST` (number `9004`) — **community test identity, not an official catalogue allocation**
ZIP SHA-256: `ddd07965bc4d841f35699a81a221b88a00233fafcf088b36a37f5904186e80f3`
App version / device / OS: app version **not specified** by the operator; all checks ran on Windows 11 through the kit's Node 22 harness (`tools/local_runtime.cjs`) — this is *not* the Flutter app. The operator's Player build performed the repository install (identity repair confirmed working — the module's home rows were inspected in-app).
Source (no tokens): `https://streamingunity.win` — operator-designated source for this exercise. It is a StreamingCommunity-family mirror; the module uses only public guest routes. No account, no DRM/login/paywall/CAPTCHA circumvention, no geo workarounds. The content rights basis is outside what the agent can verify.
Test date/time: 2026-09-18, ~20:50–23:40 local (UTC+2). Network: residential, Cloudflare-fronted hosts.

## Coverage matrix (sampled titles — exact identity)

| Exact title (year) | Season / episode | Route / audio | Result | Evidence layer | Notes |
| --- | --- | --- | --- | --- | --- |
| MobLand (2025) | S01E01 (`episode=90021`) | sub → English audio first | **PASS** | local module call + deep media verify | 4 subtitle tracks (IT Forced / IT / EN / EN CC); last cue 59:07 vs 59 min episode |
| MobLand (2025) | S01E01 | dub → Italian audio first | **PASS** | local module call | `lang=dub` ordering verified |
| MobLand (2025) | S02E01 (`episode=370187`) | dub | **PASS** | local module call | subtitle set differs per episode (EN (British), IT, IT-Forced) — mirrors source |
| The Weight (2026, movie) | single entry | — | **PASS** | local + deep | one muxed-audio master; no subtitle tracks on this title; labeled `Auto`, audio `und` (no rendition metadata on this title) |
| Slow Horses (2022) | S01E01 (`episode=29244`) | sub | **PASS** | local deep | 42 subtitle languages resolved; **all 42 byte-verified as WebVTT**, cues 600–780, last cue 53:46 vs ~54 min |
| South Park (1997) | full series | — | **PASS** | local | 332 episodes / 29 seasons in 1.59 s (parallel season fetches) |
| Korean Pork Belly Rhapsody (28904) | E1 | sub | **PASS** | local | 14 subtitle languages; audio `und` (source exposes no audio renditions on this title) |

Also exercised: 1966 catalogue title in search, 2026 releases, multi-season shows, non-Latin titles, empty search, invalid ids.

## Functional results (site-side, automated)

- `searchResults`: query → cards with exact `title`/`href`/`image` on CDN; ids stable across two identical calls; empty query → trending fallback; no-result → `[]`; special characters OK.
- **Site assertions: 35/35 passed** (`module-tests/site_checks.cjs`):
  - details: title/plot/genres/year correct (`MobLand`, Drama+Crime, 2025)
  - episodes: ascending, right counts (S1 10 + S2 1), season grouping, exact `scws` episode ids in hrefs
  - movie: single entry with the title id
  - discovery home: 5 sections in order **`trending:8 → top10:10 → latest:30 → movies:26 → tv:20`**, hero row first, **Top-10 row second with all ten ranked items**, no duplicate hrefs across sections (94 hrefs), all items complete
  - discovery feeds: trending/latest page 1+2 (50 items/page, **0 overlap between pages**), top10, movies, tv; unknown feed degrades to empty
- Edge cases **8/8**: bare numeric ids resolve via placeholder slug; invalid inputs throw (or return a clean `error` object for `extractStreamUrl`).

## Stream stage evidence

- `extractStreamUrl` latency: **1.2–2.9 s** per sample (self-deadline 16 s; app budget 30 s).
- Returned shape: language-labeled stream pairs (`English`/`Italian`), `qualities` `Auto`+numeric ladder, `subtitles[]` with per-track headers, `servers[]` rows each carrying url+headers+audio language, legacy `url`+`headers` preserved.
- Deep, kit-independent verification of returned artifacts (segments fetched with the returned URL+headers):
  - master 200 `#EXTM3U`; variant media playlists; **AES-128 key fetched (16 B)**; segment decrypted locally → TS sync byte 12/12 packets; PID inventory shows demuxed video (audio in separate renditions); the movie sample shows a muxed video+audio.
  - subtitles: every returned track downloaded; `WEBVTT` signature; cue counts and last-cue timestamps consistent with the episode duration.
- Quality ladder note: at test time the source served guests `canPlayFHD=false` → ladder was 720p/480p (1080p was offered earlier in the same session while the flag was true, and resolved). The module mirrors the flag per request; **appending `h=1` against a fresh token when the flag is false makes vixcloud answer HTTP 403** (verified) — the module only appends it when the current embed says so.
- Official kit checker (`tools/run_checks.cjs ../StreamingUnity --query "mobland" --result 1 --ep 1 --lang sub`): all ten stages **PASS** up to route sampling; then `FAIL route 1/2: Encrypted HLS needs separate authorized decode testing` — the kit's AES-128 guard (docs/10: encryption needs the full tester). Command exits 1 **because of that guard**, not a routing failure; our independent decryption above is the stronger local evidence.
- Kit offline suite: `node --test tests/kit.test.cjs` → **17/17 pass**.

## Version history & repairs

### beta.2 — repository import repair

- **Reported failure:** installing the testing repository in the operator's Player build failed with
  `FormatException: No repository modules were installed` after the bundle downloaded.
- **Root cause (documented Player rule):** `V3 module moduleIdentityNumber must be a positive integer`. The beta.1
  package carried the development identity `PENDING-OWNER-ALLOCATION` / number `0`, which passes local kit packaging
  but is rejected by the app's installer — the repository then reports zero installed modules.
- **Fix shipped in beta.2:** community test identity `SP-VID-9004-STREAMINGUNITY-HERMES-TEST` / number `9004`
  (the same convention another public testing repository documents for its own candidates — numbers `9002`/`9003`
  are in use there; `9004` was audited as unused before selection; it is not an official catalogue allocation).
  Module id/family renamed from `streamingunity-v1` / `streamingunity_v1` to `streamingunity-hermes-v1` /
  `streamingunity_hermes_v1` so the package cannot collide with the official catalogue's `streamingunity-v1`
  (SP-VID-065).
- **Repository state (as of beta.3):** bundle `Testing-5` advertises beta.3; beta.1 and beta.2 ZIPs remain on
  disk, retired from the active index (`retired-packages.json`). `repository.json` rebuilt from the package bytes.
- **Post-repair verification of the packaged artifact:**

| Check | Attempted | Passed | Failed | Evidence |
| --- | ---: | ---: | ---: | --- |
| Flat ZIP re-open + manifest identity | 1 | 1 | 0 | two entries (`module.json`, `index.js`); id `streamingunity-hermes-v1`, number `9004` |
| Search smoke from the packaged ZIP | 1 | 1 | 0 | 13 cards, first `MobLand` |
| Live stream resolution from the packaged ZIP | 1 | 1 | 0 | `English + Italian`, 4 subtitle tracks, ladder `Auto/720p/480p` |
| Repository index + bundle rebuild | 1 | 1 | 0 | `repository.json` rebuilt (bundle 4 at repair time, 5 for beta.3); module/bundle SHA-256 recomputed and checked |
| In-app install of repaired repository (operator) | 1 | 1 | 0 | module home screen reached in the Player build |

### beta.3 — discovery home row order

- **Reported issue (operator, in-app):** the “Top 10 Today” row rendered above the Trending hero — not wanted.
- **Constraint:** the app de-duplicates hrefs across sections in document order (first occurrence wins), and
  beta.2 emitted Top 10 first precisely so its exact ten ranked items survived. Reordering naively would cost the
  Top-10 row ~1 item per play (observed in beta.1-era testing: Top 10 → 9 after dedupe against the hero).
- **Fix in beta.3:** the module now **reserves the ten ranked Top-10 hrefs first, then emits rows with the hero
  first**: `Trending Now` (hero) is filtered against the reservation so both rows keep their full item counts.
  Section order shipped: `trending (hero, 8) → top10 (10) → latest (30) → movies (30) → tv (30)`.
- **Verification:** site suite extended with two order assertions → **35/35 pass**; observed sections
  `["trending:8","top10:10","latest:30","movies:26","tv:20"]`, `hero row first`, `top10 row second`,
  `top10 exactly 10`, `no duplicate hrefs across sections (94 hrefs)`. Beta.2 package retired (file kept).

## Counts

| Suite | Attempted | Passed | Failed / blocked |
| --- | --- | --- | --- |
| Site-side assertions (`site_checks.cjs`) | 35 | 35 | 0 |
| Edge assertions (`edge_checks.cjs`) | 8 | 8 | 0 |
| Stream samples (distinct episodes/titles) | 6 | 6 | 0 |
| Deep artifact verifications (incl. 42-subtitle title) | 4 | 4 | 0 |
| Kit offline tests | 17 | 17 | 0 |
| Kit `run_checks.cjs` route probes | 2 | 0 | 2 — blocked by kit encryption guard (by design) |
| Repair + order re-verification | 5 | 5 | 0 |

Defects found during testing and fixed before packaging: (1) cross-section dedupe used to shrink the Top-10 row → beta.3 reserves the ranked ten before emitting rows (hero first); (2) audio-less movie master was mislabeled “Italian” → now `Auto`/`und`; (3) default-track ordering regression → default first; (4) bare-id URLs 404 → placeholder slug; (5) repository install rejected development identity `0` → beta.2 ships community test identity `9004` and a collision-free module id. One test-harness false alarm (recon scripts hardcoded `h=1`) is documented; it was never a module defect.

## Verified / flaky / unverified

- **Verified (local, this machine):** catalogue, search, details, season/episode lists, discovery rows+feeds, **home row order + counts after reservation**, pagination without duplicates, stream resolution for 6 samples, crypto/segment structure, subtitle files + cue timing, ZIP integrity (bytes, hash, packaged smoke test), repository index/bundle rebuild + hashes, **in-app repository install of the repaired identity (operator side)**.
- **Flaky / conditional:** nothing failed intermittently. Source behaviour that varies per title: subtitle track counts (0–42), audio renditions (0–2+), ladders (360p–1080p, subject to `canPlayFHD`).
- **Unverified:** in-app **playback** (picture+sound), seek/pause, audio-track switching, subtitle rendering after the row-order change, downloads/offline, physical devices, **S2 native playback**, FHD (1080p) while guests are gated, movie audio language (muxed, not identifiable locally).

## Final verdict

- Local checks: **PASS** (with the two documented kit-guard blockers)
- Repository install (identity): **fixed**; in-app install confirmed by the operator; row order fixed in beta.3
- In-app playback: **NOT RUN** (operator to try)
- S2 (video, maintainer tools): **NOT RUN** — to be run by the maintainer
- Physical-device playback/reader: **NOT RUN**
- Download/offline: **NOT RUN**
- Release approved by: repository-owner request (testing repository only; official catalogue not requested or implied)

---

**Version:** 1.0.0-beta.3 · **ZIP:** `Testing-Modules-1234/modules/StreamingUnityHermes-1.0.0-beta.3.zip` · **SHA-256:** `ddd07965bc4d841f35699a81a221b88a00233fafcf088b36a37f5904186e80f3`
**Counts:** 77 attempted / 75 passed / 2 blocked-by-kit-guard (see table) · failure reasons: none from the module; the 2 blocked probes are the kit's deliberate AES-128 refusal
**Platforms actually tested:** Windows 11 + Node 22 local harness; operator's Player build exercised repository import + module home (version unspecified)
**Remaining limitations:** in-app playback and captions/audio switching unverified (S2 required); playback of individual quality URLs must be validated in the app because the audio is in master renditions; 42-language titles cause ~50 requests/play by design; `canPlayFHD` gating changes the ladder; source content varies per title; identity `9004` is a community test identity, not an official allocation.
