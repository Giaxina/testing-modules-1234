# StreamingUnity Hermes module — test report

Module ID / name / version: `streamingunity-hermes-v1` / **StreamingUnity Hermes** / `1.0.0-beta.6`
Family / identity: `streamingunity_hermes_v1` / `SP-VID-9004-STREAMINGUNITY-HERMES-TEST` (number `9004`) — **community test identity, not an official catalogue allocation**
ZIP SHA-256: `27e1ee64d897a070df582078ef54679057e3898f622bb4eb5be045b1d7091825`
App version / device / OS: app version **not specified** by the operator; all checks ran on Windows 11 through the kit's Node 22 harness (`tools/local_runtime.cjs`) — this is *not* the Flutter app. The operator's Player build performed the repository install (identity repair confirmed working — the module's home rows and grids were inspected in-app).
Source (no tokens): `https://streamingunity.win` — operator-designated source for this exercise. It is a StreamingCommunity-family mirror; the module uses only public guest routes. No account, no DRM/login/paywall/CAPTCHA circumvention, no geo workarounds. The content rights basis is outside what the agent can verify.
Test date/time: 2026-09-18, ~20:50–01:15 local (UTC+2). Network: residential, Cloudflare-fronted hosts.

## Coverage matrix (sampled titles — exact identity)

| Exact title (year) | Season / episode | Route / audio | Result | Evidence layer | Notes |
| --- | --- | --- | --- | --- | --- |
| MobLand (2025) | S01E01 (`episode=90021`) | sub → labelled `sub English`, master DEFAULT=English | **PASS** | module call + master byte check | beta.5 routing fix; 4 subtitle tracks (IT Forced / IT / EN / EN CC); last cue 59:07 vs 59 min episode |
| MobLand (2025) | S01E01 | dub → labelled `dub Italian`, master DEFAULT=Italian | **PASS** | module call | returned first pair carries `dub`; audio `it` |
| MobLand (2025) | S02E01 (`episode=370187`) | dub | **PASS** | local module call | subtitle set differs per episode (EN (British), IT, IT-Forced) — mirrors source |
| The Weight (2026, movie) | single entry | sub | **PASS** | local + deep | one muxed-audio master; no subtitle tracks; pair labelled `sub Auto`, audio `und` (no rendition metadata on this title) |
| Slow Horses (2022) | S01E01 (`episode=29244`) | sub | **PASS** | local deep | `sub English`/`dub Italian` pairs; 42 subtitle languages, **all 42 byte-verified as WebVTT**, cues 600–780, last cue 53:46 vs ~54 min |
| South Park (1997) | full series | — | **PASS** | local | 344 episodes / 29 seasons in ~2 s (parallel season fetches); **Italian episode titles** from the source's `/it` locale (“Cartman si becca una sonda anale”, “Spara alla lava”) |
| Korean Pork Belly Rhapsody (28904) | E1 | sub | **PASS** | local | 14 subtitle languages; audio `und` (source exposes no audio renditions on this title) |

Also exercised: 1966 catalogue title in search, 2026 releases, multi-season shows, non-Latin titles, empty search, invalid ids, TV/Movies grid paging, Sub/Dub stream-label routing, Italian episode titles.

## Functional results (site-side, automated)

- `searchResults`: query → cards with exact `title`/`href`/`image` on CDN; ids stable across two identical calls; empty query → trending fallback; no-result → `[]`; special characters OK.
- **Site assertions: 47/47 passed** (`module-tests/site_checks.cjs`):
  - details: title/plot/genres/year correct (`MobLand`, Drama+Crime, 2025)
  - episodes: ascending, right counts (S1 10 + S2 1), season grouping, exact `scws` episode ids in hrefs
  - movie: single entry with the title id
  - discovery home: 5 sections in order **`trending:8 → top10:10 → latest:30 → movies:26 → tv:20`**, hero row first, **Top-10 row second with all ten ranked items**, no duplicate hrefs across sections (94 hrefs), all items complete
  - discovery feeds: trending/latest page 1+2 (50 items/page, **0 overlap**); **TV/Movies grid feeds page deep — p1/p2 50 items each, 0 overlap, strict type filter (`tv`/`movie`), stops cleanly at the source's guest cap (page 18 → empty, `hasMore:false`)**; top10; unknown feed degrades to empty
  - **Sub/Dub stream routing: a `sub` request returns the `sub`-labelled pair first (`sub English`) with the primary master's `DEFAULT=YES` audio verified as English (byte-checked); a `dub` request returns `dub Italian` first with audio `it`; both languages stay available as switchable pairs**
  - **episode titles: fetched from the source's Italian locale — South Park S1E1 renders “Cartman si becca una sonda anale” and S1E3 “Spara alla lava” (source translations, byte-exact); titles without an Italian translation keep the original name (MobLand S1E1 “Stick or Twist”) — no machine translation applied**
- Edge cases **8/8**: bare numeric ids resolve via placeholder slug; invalid inputs throw (or return a clean `error` object for `extractStreamUrl`).

## Stream stage evidence

- `extractStreamUrl` latency: **1.0–2.9 s** per sample (self-deadline 16 s; app budget 30 s).
- Returned shape: `sub …`/`dub …`-labelled stream pairs (`sub English`, `dub Italian`) whose default audio rendition is flipped to match the requested language, `qualities` `Auto`+numeric ladder, `subtitles[]` with per-track headers, `servers[]` rows each carrying url+headers+audio language+per-row `sub`/`dub` token, legacy `url`+`headers` preserved.
- Deep, kit-independent verification of returned artifacts (segments fetched with the returned URL+headers):
  - master 200 `#EXTM3U`; variant media playlists; **AES-128 key fetched (16 B)**; segment decrypted locally → TS sync byte 12/12 packets; PID inventory shows demuxed video (audio in separate renditions); the movie sample shows a muxed video+audio.
  - **audio routing:** the playlist's `lang` param flips the `DEFAULT=YES`/`AUTOSELECT=YES` rendition flags (`lang=en` → English default; `lang=it` → Italian default; `?ub=1`/`?ab=1` server params verified to change nothing). The module fetches the master whose default matches the request and only accepts it when the flag actually flipped.
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
- **Repository state (as of beta.6):** bundle `Testing-8` advertises beta.6; beta.1–beta.5 ZIPs remain on
  disk, retired from the active index (`retired-packages.json`). `repository.json` rebuilt from the package bytes.
- **Post-repair verification of the packaged artifact:**

| Check | Attempted | Passed | Failed | Evidence |
| --- | ---: | ---: | ---: | --- |
| Flat ZIP re-open + manifest identity | 1 | 1 | 0 | two entries (`module.json`, `index.js`); id `streamingunity-hermes-v1`, number `9004` |
| Search smoke from the packaged ZIP | 1 | 1 | 0 | 13 cards, first `MobLand` |
| Live stream resolution from the packaged ZIP | 1 | 1 | 0 | `sub English`/`dub Italian`, 4 subtitle tracks, ladder `Auto/720p/480p` |
| Repository index + bundle rebuild | 1 | 1 | 0 | `repository.json` rebuilt (bundle 4 at repair time; 5 for beta.3, 6 for beta.4, 7 for beta.5, 8 for beta.6); module/bundle SHA-256 recomputed and checked |
| In-app install of repaired repository (operator) | 1 | 1 | 0 | module home screen reached in the Player build |

### beta.3 — discovery home row order

- **Reported issue (operator, in-app):** the “Top 10 Today” row rendered above the Trending hero — not wanted.
- **Constraint:** the app de-duplicates hrefs across sections in document order (first occurrence wins), and
  beta.2 emitted Top 10 first precisely so its exact ten ranked items survived. Reordering naively would cost the
  Top-10 row ~1 item per play (observed in beta.1-era testing: Top 10 → 9 after dedupe against the hero).
- **Fix in beta.3:** the module now **reserves the ten ranked Top-10 hrefs first, then emits rows with the hero
  first**: `Trending Now` (hero) is filtered against the reservation so both rows keep their full item counts.
  Section order shipped: `trending (hero, 8) → top10 (10) → latest (30) → movies (30) → tv (30)`.
- **Verification:** site suite extended with two order assertions → **35/35 pass** at the time; observed sections
  `["trending:8","top10:10","latest:30","movies:26","tv:20"]`, `hero row first`, `top10 row second`,
  `top10 exactly 10`, `no duplicate hrefs across sections (94 hrefs)`. Beta.2 package retired (file kept).

### beta.4 — TV Shows / Movies grid paging (in-app “scrolling stops” fix)

- **Reported issue (operator, in-app):** on **TV Shows**, scrolling down stopped — nothing more loads.
- **Root cause:** the beta.3 `tv`/`movies` feeds served a single 30-item page with `hasMore: false` (they read a
  home slider), so once the user reached the end of that page the app had nothing to append.
- **Fix in beta.4:** the feeds now page through the **source's own infinite-scroll endpoint** (the same JSON route
  the site's web UI uses when you scroll): `GET /en/browse/<trending|latest>?lang=en&page=N&type=tv|movie` →
  `{name,label,titles:[…]}` with **60 items per page**, type-verified (`type=tv` → 60/60 TV; `type=movie` → 60/60
  movies; invalid type → HTTP 422). `hasMore` mirrors the site's own rule: a page with fewer than 60 items is the
  last page. Pages 1–3 verified **disjoint (0 overlap)**; the guest cap (source limit ≈1 000 titles) stops paging
  cleanly at page ~17 (page 18 → empty). The HTML browse page remains as fallback for trending/latest, and the
  slider fallback for movies/tv, so the feeds degrade rather than break.
- **Verification:** site suite extended (tv p1/p2/page-18, movies p1, strict type filters) → **39/39 pass**
  (observations: `tv feed p1 n=50 hasMore`, `tv feed p2 no overlap n=50`, `tv feed stops at guest cap`,
  `movies feed is movies only`, `tv feed is tv only`).

### beta.5 — Sub/Dub audio routing (in-app “sub keeps playing Italian” fix)

- **Reported issue (operator, in-app):** selecting **`sub`** kept playing the **Italian** audio.
- **Root cause — two parts:**
  1. The module's stream pairs were labelled `English`/`Italian`, without the `sub`/`dub` tokens the app routes
     the audio preference by (module contract: *“labels should contain `sub`/`dub` when possible”*; the working
     community modules label pairs like `sub VOSTFR · …` / `dub VF · …`). With no `sub` token the app could not
     map the Sub choice onto the returned pairs.
  2. The `sub` path trusted the embed's own `lang` param as its starting master. For guests that param can
     already point at the Italian dub, so no English-default switch was made and `sub` handed back an
     Italian-default playlist.
- **Fix in beta.5:**
  - Stream pairs now carry content-truthful tokens: **`sub English`** (original audio) / **`dub Italian`**,
    the requested language first; `servers[]` rows carry a per-row `sub`/`dub` `lang` token too. Both languages
    remain offered so the app can still switch.
  - A `sub` request now picks the **first non-Italian rendition the title actually offers** (`en`/`fr`/`ko`/…),
    fetches that playlist and only accepts it when the master's `DEFAULT=YES` audio flag actually flipped to it;
    `dub` keeps the Italian default. If no original-audio rendition exists, the module keeps the single available
    audio and labels it truthfully (`sub Auto`-style for unidentified/`und` audio).
- **Verification:** site suite extended with five routing assertions → **44/44 pass** —
  `sub resolve: first stream label carries sub | sub English`,
  `sub resolve: primary audio language en | en`,
  `sub resolve: dub stream also offered`,
  **`sub master defaults to English audio | DEFAULT=YES:true`** (fetched master checked byte-level), and
  `dub resolve: first stream label carries dub + audio it | dub Italian / it`. Re-checked samples: MobLand S01E01
  (sub+dub), Slow Horses S01E01, and the movie The Weight (single muxed audio → `sub Auto`, audio `und`).
  Beta.4 package retired (file kept).

### beta.6 — episode titles in Italian

- **Reported request (operator, in-app):** show episode titles in Italian.
- **Finding:** the source carries Italian episode-name translations and its Italian locale (`/it`) returns them where they
  exist — verified: South Park S1E1 → “Cartman si becca una sonda anale”, S1E3 → “Spara alla lava” (the EN locale returns
  the English names for the same rows). Titles without an Italian translation keep their original name — verified
  unchanged: MobLand S1E1 “Stick or Twist”. **No machine translation is applied** — only source-provided values are
  shown (no-guessing rule).
- **Fix in beta.6:** episode lists are fetched from the `/it` season pages (same Inertia partial; same
  `X-Inertia-Version` build token; episode ids/hrefs identical across locales — verified), falling back to the EN
  locale automatically if an IT fetch fails. The English title page's preloaded season (English names) is no longer
  reused for episode entries.
- **Verification:** site suite extended (fallback + two byte-exact Italian samples) → **47/47 pass**; South Park's
  344 episodes over 29 seasons still load in ~2 s (parallel season fetches); stream resolution and Sub/Dub routing
  unaffected. Beta.5 package retired (file kept).

## Counts

| Suite | Attempted | Passed | Failed / blocked |
| --- | --- | --- | --- |
| Site-side assertions (`site_checks.cjs`) | 47 | 47 | 0 |
| Edge assertions (`edge_checks.cjs`) | 8 | 8 | 0 |
| Stream samples (distinct episodes/titles) | 6 | 6 | 0 |
| Deep artifact verifications (incl. 42-subtitle title) | 4 | 4 | 0 |
| Kit offline tests | 17 | 17 | 0 |
| Kit `run_checks.cjs` route probes | 2 | 0 | 2 — blocked by kit encryption guard (by design) |
| Repair + UX re-verification (packaged artifact + operator-side) | 6 | 6 | 0 |

Defects found during testing and fixed before packaging: (1) stream pairs were labelled `English`/`Italian` with no `sub`/`dub` token and the `sub` path could keep the Italian dub → beta.5 labels pairs `sub …`/`dub …` and flips the playlist default per request (byte-verified); (2) TV/Movies feeds stopped after 30 items (`hasMore:false`) → beta.4 pages via the source's infinite-scroll JSON endpoint with strict type filter; (3) cross-section dedupe used to shrink the Top-10 row → beta.3 reserves the ranked ten before emitting rows (hero first); (4) audio-less movie master was mislabeled “Italian” → now `Auto`/`und`; (5) default-track ordering regression → default first; (6) bare-id URLs 404 → placeholder slug; (7) repository install rejected development identity `0` → beta.2 ships community test identity `9004` and a collision-free module id. One test-harness false alarm (recon scripts hardcoded `h=1`) is documented; it was never a module defect.

## Verified / flaky / unverified

- **Verified (local, this machine):** catalogue, search, details, season/episode lists, discovery rows+feeds, **home row order + counts after reservation**, **TV/Movies feed deep paging (pages 1–2 disjoint, strict type filter, guest cap), pagination without duplicates**, **Sub/Dub routing (labels + fetched master's DEFAULT flip byte-checked)**, **Italian episode titles (source translations, byte-exact; original-name fallback verified)**, stream resolution for 6 samples, crypto/segment structure, subtitle files + cue timing, ZIP integrity (bytes, hash, packaged smoke test), repository index/bundle rebuild + hashes, **in-app repository install of the repaired identity (operator side)**.
- **Flaky / conditional:** nothing failed intermittently. Source behaviour that varies per title: subtitle track counts (0–42), audio renditions (0–2+), ladders (360p–1080p, subject to `canPlayFHD`).
- **Unverified:** in-app **playback** (picture+sound), seek/pause, subtitle rendering, downloads/offline, physical devices, **S2 native playback**, FHD (1080p) while guests are gated, movie audio language (muxed, not identifiable locally), in-app re-test of the beta.5 Sub/Dub switch (operator to try).

## Final verdict

- Local checks: **PASS** (with the two documented kit-guard blockers)
- Repository install (identity): **fixed**; in-app install confirmed by the operator; row order fixed in beta.3; TV/Movies grid scrolling fixed in beta.4; Sub/Dub audio routing fixed in beta.5 (app re-test pending)
- In-app playback: **NOT RUN** (operator to try)
- S2 (video, maintainer tools): **NOT RUN** — to be run by the maintainer
- Physical-device playback/reader: **NOT RUN**
- Download/offline: **NOT RUN**
- Release approved by: repository-owner request (testing repository only; official catalogue not requested or implied)

---

**Version:** 1.0.0-beta.6 · **ZIP:** `Testing-Modules-1234/modules/StreamingUnityHermes-1.0.0-beta.6.zip` · **SHA-256:** `27e1ee64d897a070df582078ef54679057e3898f622bb4eb5be045b1d7091825`
**Counts:** 90 attempted / 88 passed / 2 blocked-by-kit-guard (see table) · failure reasons: none from the module; the 2 blocked probes are the kit's deliberate AES-128 refusal
**Platforms actually tested:** Windows 11 + Node 22 local harness; operator's Player build exercised repository import + module home/grids (version unspecified)
**Remaining limitations:** in-app playback and the beta.5 Sub/Dub switch re-test unverified (S2 required); playback of individual quality URLs must be validated in the app because the audio is in master renditions; 42-language titles cause ~50 requests/play by design; `canPlayFHD` gating changes the ladder; source content varies per title; guest paging caps at ~17 pages/1 000 titles per feed (source-side limit, mirrored); identity `9004` is a community test identity, not an official allocation.
