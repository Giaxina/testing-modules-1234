/* ============================================================================
 * StreamingUnity — streamingunity.win (English interface) for Synthetiq Player
 * Contract v4, discovery_v1 enabled. Self-contained: no Node, no browser DOM,
 * no timers. All requests go through fetchv2.
 *
 * Verified source chain (recon 2026-09-18):
 *   catalogue : /en/browse/trending | /en/browse/latest (?page=N), /en/search?q=
 *   home rows : /en (trending/latest/top10 sliders), /en/movies, /en/tv-shows
 *   details   : /en/titles/{id}-{slug}            -> Inertia data-page JSON
 *   seasons   : /en/titles/{id}-{slug}/season-{n} -> Inertia partial (loadedSeason)
 *   watch     : /en/watch/{titleId}[?episode=..]  -> embedUrl
 *   embed     : /en/iframe/{titleId}?episode_id=..&next_episode=1 -> iframe src
 *   player    : vixcloud.co/embed/{scwsId}?token=.. -> window.streams / masterPlaylist
 *   playlist  : {masterPlaylist.url}&token&expires&h=1&lang=.. (Referer = embed URL)
 *              -> HLS master: video ladder + audio renditions + subtitle playlists;
 *                 segments AES-128, separate audio renditions (demuxed HLS).
 *
 * Known boundaries (see report): vixcloud aggregates refusals under burst use are
 * handled with a single fresh-token retry; per-quality variant URLs are video
 * media playlists and rely on the player resolving the master audio group.
 * ========================================================================== */
(function () {
  'use strict';

  var SITE = 'https://streamingunity.win';
  var LOCALE = 'en';
  var VIX = 'https://vixcloud.co';
  var CDN = 'https://cdn.streamingunity.win';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  var HTML_HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  var JSON_HEADERS = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  function now() { return Date.now(); }
  function left(deadline, cap) { return Math.max(800, Math.min(deadline - now(), cap || 12000)); }
  function log() { try { if (typeof console !== 'undefined' && console.warn) console.warn.apply(console, arguments); } catch (_) {} }

  /* ------------------------------------------------------------ text utils */

  function unescapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#x2F;/gi, '/')
      .replace(/&apos;/gi, "'")
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&');
  }

  function clean(value) {
    return unescapeHtml(String(value == null ? '' : value).replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  function absolute(href, base) {
    var v = String(href == null ? '' : href).trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/^\/\//.test(v)) return 'https:' + v;
    if (/^\//.test(v)) return SITE + v;
    return (base || SITE) + '/' + v.replace(/^\.?\//, '');
  }

  /* Resolve a possibly relative URI against an absolute base (for m3u8 URIs). */
  function absoluteFrom(href, base) {
    var v = String(href == null ? '' : href).trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/^\/\//.test(v)) return 'https:' + v;
    if (/^\//.test(v)) {
      var m = String(base || '').match(/^https?:\/\/[^/]+/i);
      return (m ? m[0] : VIX) + v;
    }
    var dir = String(base || '').replace(/[?#].*$/, '').replace(/\/[^/]*$/, '/');
    return dir + v;
  }

  function getParam(url, name) {
    var m = String(url == null ? '' : url).match(new RegExp('[?&]' + name + '=([^&#]*)'));
    return m ? unescapeHtml(decodeURIComponent(m[1])) : '';
  }

  function addQuery(url, name, value) {
    if (value == null || value === '') return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + encodeURIComponent(name) + '=' + encodeURIComponent(String(value));
  }

  function quotedField(text, name) {
    var re = new RegExp("['\"]" + name + "['\"]\\s*:\\s*['\"]([^'\"]*)['\"]");
    var m = String(text || '').match(re);
    return m ? m[1] : '';
  }

  /* Balanced JSON slice walker (string-aware) for inline script blobs. */
  function sliceBalanced(text, start, open, close) {
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var i = start; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function jsonAfter(text, marker, open, close) {
    var at = String(text || '').indexOf(marker);
    if (at < 0) return null;
    var start = text.indexOf(open, at + marker.length);
    if (start < 0) return null;
    var slice = sliceBalanced(text, start, open, close);
    if (!slice) return null;
    try { return JSON.parse(slice); } catch (_) { return null; }
  }

  function extractDataPage(html) {
    var m = String(html == null ? '' : html).match(/data-page="([^"]*)"/);
    if (!m) return null;
    try { return JSON.parse(unescapeHtml(m[1])); } catch (_) { return null; }
  }

  function shortLang(value) {
    var s = String(value == null ? '' : value).toLowerCase();
    if (!s) return 'und';
    if (s.indexOf('eng') >= 0) return 'en';
    if (s.indexOf('ita') >= 0) return 'it';
    if (s.indexOf('spa') >= 0) return 'es';
    if (s.indexOf('fra') >= 0) return 'fr';
    if (s.indexOf('deu') >= 0) return 'de';
    if (s.indexOf('kor') >= 0) return 'ko';
    if (s.indexOf('jpn') >= 0) return 'ja';
    var m = s.match(/^[a-z]{2,3}$/);
    return m ? m[0] : 'und';
  }

  function langLabel(code, fallback) {
    if (code === 'und') return 'Auto';
    var names = { en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German', ko: 'Korean', ja: 'Japanese' };
    return names[code] || fallback || code || 'Audio';
  }

  /* ------------------------------------------------------------- http layer */

  async function requestText(url, headers, timeoutMs) {
    var res = await fetchv2(url, headers || HTML_HEADERS, 'GET', null, { timeoutMs: timeoutMs || 30000 });
    var status = Number(res && (res.status || res.statusCode)) || 0;
    var text = '';
    if (res && typeof res.text === 'function') { try { text = await res.text(); } catch (_) {} }
    if (!text && res && typeof res.body === 'string') text = res.body;
    if (!text && res && res.body && typeof res.body === 'object') { try { text = JSON.stringify(res.body); } catch (_) {} }
    if (!text && res && typeof res.json === 'function') { try { var j = await res.json(); if (j != null) text = JSON.stringify(j); } catch (_) {} }
    return { status: status, text: String(text || ''), headers: (res && res.headers) || {} };
  }

  async function requestJson(url, headers, timeoutMs) {
    var res = await fetchv2(url, headers || { 'User-Agent': UA }, 'GET', null, { timeoutMs: timeoutMs || 30000 });
    var status = Number(res && (res.status || res.statusCode)) || 0;
    var data = null;
    if (res && typeof res.json === 'function') { try { data = await res.json(); } catch (_) {} }
    else if (res && res.json != null) data = res.json;
    if (data == null && res && typeof res.body === 'string' && res.body) { try { data = JSON.parse(res.body); } catch (_) {} }
    if (data == null && res && res.body && typeof res.body === 'object') data = res.body;
    if (data == null && res && typeof res.text === 'function') {
      var t = '';
      try { t = await res.text(); } catch (_) {}
      if (t) { try { data = JSON.parse(t); } catch (_) {} }
    }
    return { status: status, data: data };
  }

  /* Small promise pool: bounded concurrency, no timers. */
  async function mapPool(items, limit, worker) {
    var results = new Array(items.length);
    var cursor = 0;
    async function runner() {
      for (;;) {
        var index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        try { results[index] = await worker(items[index], index); }
        catch (_) { results[index] = null; }
      }
    }
    var runners = [];
    var count = Math.min(limit, items.length);
    for (var k = 0; k < count; k += 1) runners.push(runner());
    await Promise.all(runners);
    return results;
  }

  /* ---------------------------------------------------------- catalogue map */

  function imageFor(images, wide) {
    if (!Array.isArray(images) || !images.length) return '';
    var order = wide ? ['background', 'cover', 'poster', 'cover_mobile'] : ['poster', 'cover', 'background', 'cover_mobile'];
    for (var pass = 0; pass < 2; pass += 1) {
      for (var o = 0; o < order.length; o += 1) {
        for (var i = 0; i < images.length; i += 1) {
          var im = images[i] || {};
          if (im.type !== order[o] || !im.filename) continue;
          if (pass === 0 && im.lang && im.lang !== 'en') continue;
          return CDN + '/images/' + im.filename;
        }
      }
    }
    return '';
  }

  function cardFrom(item, wide) {
    if (!item || !item.id) return null;
    var name = clean(item.name);
    if (!name) return null;
    var image = imageFor(item.images, !!wide);
    var year = String(item.last_air_date || item.release_date || item.last_air_date_it || '').slice(0, 4);
    var bits = [item.type === 'tv' ? 'TV Series' : 'Movie'];
    if (year) bits.push(year);
    if (item.score) bits.push('\u2605 ' + item.score);
    var out = {
      id: String(item.id),
      href: SITE + '/' + LOCALE + '/titles/' + item.id + '-' + item.slug,
      title: name,
      image: image,
      poster: image,
      type: 'video',
      description: bits.join(' \u00b7 ')
    };
    if (year) out.year = year;
    if (item.score) out.score = String(item.score);
    return out;
  }

  function cardsFrom(list, wide) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i += 1) {
      var card = cardFrom(list[i], wide);
      if (card) out.push(card);
    }
    return out;
  }

  function parseTitleRef(input) {
    var v = String(input == null ? '' : input).trim();
    if (!v) return null;
    var m = v.match(/\/titles\/(\d+)(?:-([^\/?#]*))?/);
    if (m) {
      /* The slug is decorative for routing; a placeholder keeps bare-id URLs valid. */
      var slug = m[2] || 'x';
      return { id: m[1], slug: slug, url: SITE + '/' + LOCALE + '/titles/' + m[1] + '-' + slug };
    }
    if (/^\d+$/.test(v)) return { id: v, slug: 'x', url: SITE + '/' + LOCALE + '/titles/' + v + '-x' };
    return null;
  }

  function parseWatchRef(input) {
    var v = String(input == null ? '' : input).trim();
    if (!v) return null;
    var titleId = '';
    var episodeId = '';
    var m = v.match(/\/watch\/(\d+)/);
    if (m) titleId = m[1];
    if (!titleId) {
      var ref = parseTitleRef(v);
      if (ref) titleId = ref.id;
      else if (/^\d+$/.test(v)) titleId = v;
    }
    if (!titleId) return null;
    episodeId = getParam(v, 'episode');
    if (!/^\d+$/.test(episodeId)) episodeId = '';
    return {
      titleId: titleId,
      episodeId: episodeId,
      watchUrl: SITE + '/' + LOCALE + '/watch/' + titleId + (episodeId ? '?episode=' + episodeId : '')
    };
  }

  async function fetchTitlePage(ref, deadline) {
    var page = await requestText(ref.url, Object.assign({}, HTML_HEADERS, { Referer: SITE + '/' }), left(deadline, 12000));
    if (page.status !== 200) throw new Error('title page HTTP ' + page.status);
    var dp = extractDataPage(page.text);
    if (!dp || !dp.props || !dp.props.title) throw new Error('title data missing');
    return dp;
  }

  /* ================================================================ SEARCH */

  async function searchResults(query) {
    var deadline = now() + 15000;
    var term = clean(query);
    var url = term
      ? SITE + '/' + LOCALE + '/search?q=' + encodeURIComponent(term)
      : SITE + '/' + LOCALE + '/browse/trending';
    var res = await requestText(url, Object.assign({}, HTML_HEADERS, { Referer: SITE + '/' }), left(deadline, 12000));
    if (res.status !== 200) throw new Error('StreamingUnity search HTTP ' + res.status);
    var dp = extractDataPage(res.text);
    var titles = (dp && dp.props && dp.props.titles) || [];
    return cardsFrom(titles).slice(0, 60);
  }

  /* =============================================================== DETAILS */

  async function extractDetails(urlOrId) {
    var deadline = now() + 15000;
    var ref = parseTitleRef(urlOrId);
    if (!ref) throw new Error('StreamingUnity: invalid title id or URL');
    var dp = await fetchTitlePage(ref, deadline);
    var t = dp.props.title;
    var image = imageFor(t.images);
    var genres = [];
    (Array.isArray(t.genres) ? t.genres : []).forEach(function (g) {
      var name = clean(g && g.name);
      if (name && genres.indexOf(name) < 0) genres.push(name);
    });
    var out = {
      id: String(t.id),
      href: ref.url,
      url: ref.url,
      title: clean(t.name),
      description: clean(t.plot) || '',
      image: image,
      poster: image,
      type: 'video',
      genres: genres,
      status: clean(t.status)
    };
    var year = String(t.release_date || '').slice(0, 4);
    if (year) out.year = year;
    if (t.score) out.score = String(t.score);
    if (t.seasons_count) out.seasonsCount = Number(t.seasons_count);
    return out;
  }

  /* ============================================================== EPISODES */

  var episodesCache = {};

  function seasonUrl(titleId, slug, num, locale) {
    return SITE + '/' + (locale || LOCALE) + '/titles/' + titleId + (slug ? '-' + slug : '') + '/season-' + num;
  }

  async function fetchSeason(titleId, slug, num, version, deadline) {
    /* Episode names are fetched from the Italian locale so they appear in
     * Italian whenever the source carries an Italian translation (titles
     * without one keep their original name). Episode ids/hrefs are identical
     * in both locales; the English locale stays as fallback. */
    var locales = ['it', LOCALE];
    var lastError = null;
    for (var li = 0; li < locales.length; li += 1) {
      var locale = locales[li];
      var url = seasonUrl(titleId, slug, num, locale);
      var headers = {
        'User-Agent': UA,
        'Accept': 'text/html, application/xhtml+xml',
        'X-Inertia': 'true',
        'X-Inertia-Version': version || '',
        'X-Inertia-Partial-Data': 'loadedSeason,flash',
        'X-Inertia-Partial-Component': 'Titles/Title',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': SITE + '/' + locale + '/titles/' + titleId + '-' + (slug || 'x')
      };
      try {
        var res = await requestJson(url, headers, left(deadline, 8000));
        if (res.status !== 200 || !res.data) throw new Error('season ' + num + ' HTTP ' + res.status);
        var ls = res.data.props && res.data.props.loadedSeason;
        if (!ls || !Array.isArray(ls.episodes)) throw new Error('season ' + num + ' episodes missing');
        return ls;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('season ' + num + ' unavailable');
  }

  function episodeEntry(titleId, ep, seasonNumber) {
    var num = Number(ep && ep.number);
    var valid = isFinite(num) && num > 0;
    return {
      number: valid ? num : 0,
      href: SITE + '/' + LOCALE + '/watch/' + titleId + '?episode=' + (ep && ep.id),
      title: clean(ep && ep.name) || ('Episode ' + (valid ? num : '?')),
      season: seasonNumber || null,
      subAvailable: !(ep && ep.audio_orig === 0),
      dubAvailable: !!(ep && ep.dub_ita === 1)
    };
  }

  async function extractEpisodes(seriesId) {
    var deadline = now() + 15000;
    var ref = parseTitleRef(seriesId);
    if (!ref) throw new Error('StreamingUnity: invalid title id or URL');
    var cached = episodesCache[ref.id];
    if (cached && now() - cached.at < 180000) return cached.items;

    var dp = await fetchTitlePage(ref, deadline);
    var title = dp.props.title;
    var version = dp.version || '';
    var loadedSeason = dp.props.loadedSeason || null;
    var items = [];

    if (title.type === 'movie') {
      items.push({
        number: 1,
        href: SITE + '/' + LOCALE + '/watch/' + title.id,
        title: clean(title.name) || 'Movie',
        season: null,
        subAvailable: !(title.audio_orig === 0),
        dubAvailable: title.dub_ita === 1
      });
    } else {
      var seasons = Array.isArray(title.seasons) ? title.seasons.slice() : [];
      var known = {};
      var jobs = [];
      for (var s = 0; s < seasons.length; s += 1) {
        var sn = Number(seasons[s] && seasons[s].number);
        if (!isFinite(sn)) continue;
        known[sn] = true;
        /* Always fetch the season so episode names come from the Italian
         * locale; the EN title page's loadedSeason is not reused. */
        jobs.push({ num: sn, season: null });
      }
      if (loadedSeason && !known[Number(loadedSeason.number)]) {
        jobs.push({ num: Number(loadedSeason.number) || 0, season: null });
      }
      if (!jobs.length && loadedSeason) jobs.push({ num: Number(loadedSeason.number) || 0, season: null });

      var fetchJob = async function (job) {
        if (job.season) return job.season;
        if (now() >= deadline) return null;
        try { return await fetchSeason(title.id, title.slug || 'x', job.num, version, deadline); }
        catch (_) { return null; }
      };
      var results = await mapPool(jobs, 3, fetchJob);

      /* One bounded retry for seasons that failed while budget remains. */
      var missing = [];
      for (var i = 0; i < results.length; i += 1) {
        if (!results[i] && now() < deadline - 1500) missing.push(i);
      }
      if (missing.length) {
        var retried = await mapPool(missing, 2, async function (idx) { return await fetchJob(jobs[idx]); });
        for (var j = 0; j < missing.length; j += 1) {
          if (retried[j]) results[missing[j]] = retried[j];
        }
      }

      var failedSeasons = [];
      for (var r = 0; r < results.length; r += 1) {
        var ls = results[r];
        if (!ls || !Array.isArray(ls.episodes)) { failedSeasons.push(jobs[r].num); continue; }
        for (var e = 0; e < ls.episodes.length; e += 1) {
          items.push(episodeEntry(title.id, ls.episodes[e], Number(ls.number)));
        }
      }
      if (failedSeasons.length) {
        log('StreamingUnity: season(s) unavailable in time: ' + failedSeasons.join(', ') + ' (title ' + title.id + ')');
      }
      items.sort(function (a, b) {
        var sa = a.season || 0;
        var sb = b.season || 0;
        if (sa !== sb) return sa - sb;
        return a.number - b.number;
      });
    }

    episodesCache[ref.id] = { at: now(), items: items };
    return items;
  }

  /* ================================================================ STREAM */

  async function vixChain(ref, deadline) {
    var iframeUrl = SITE + '/' + LOCALE + '/iframe/' + ref.titleId +
      (ref.episodeId ? '?episode_id=' + ref.episodeId + '&next_episode=1' : '');
    var page = await requestText(iframeUrl, Object.assign({}, HTML_HEADERS, { Referer: ref.watchUrl }), left(deadline, 8000));
    if (page.status !== 200) throw new Error('embed page HTTP ' + page.status);
    var m = page.text.match(/<iframe[^>]*src="([^"]+)"/i);
    if (!m) throw new Error('embed iframe not found');
    var src = unescapeHtml(m[1]);
    if (src.indexOf('vixcloud.co/embed/') < 0) throw new Error('unexpected embed host');

    var embed = await requestText(src, Object.assign({}, HTML_HEADERS, { Referer: SITE + '/' }), left(deadline, 8000));
    if (embed.status !== 200) throw new Error('player page HTTP ' + embed.status);

    var marker = embed.text.indexOf('window.masterPlaylist');
    if (marker < 0) throw new Error('player data missing');
    var seg = embed.text.slice(marker, marker + 1600);
    var urlMatch = seg.match(/url\s*:\s*['"]([^'"]+)['"]/);
    if (!urlMatch) throw new Error('playlist url missing');
    var mp = {
      url: urlMatch[1],
      params: {
        token: quotedField(seg, 'token'),
        expires: quotedField(seg, 'expires'),
        asn: quotedField(seg, 'asn')
      }
    };
    var streams = jsonAfter(embed.text, 'window.streams', '[', ']') || [];
    return {
      src: src,
      mp: mp,
      streams: Array.isArray(streams) ? streams : [],
      canPlayFHD: getParam(src, 'canPlayFHD') === '1',
      embedLang: getParam(src, 'lang') || LOCALE
    };
  }

  function buildPlaylistUrl(chain, baseUrl, langValue) {
    var url = baseUrl || chain.mp.url;
    url = addQuery(url, 'token', chain.mp.params.token);
    url = addQuery(url, 'expires', chain.mp.params.expires);
    url = addQuery(url, 'asn', chain.mp.params.asn);
    if (chain.canPlayFHD) url = addQuery(url, 'h', '1');
    url = addQuery(url, 'lang', langValue || chain.embedLang || LOCALE);
    return url;
  }

  async function fetchMaster(chain, langValue, deadline) {
    var headers = { 'User-Agent': UA, 'Accept': '*/*', 'Referer': chain.src };
    var first = buildPlaylistUrl(chain, null, langValue);
    var res = await requestText(first, headers, left(deadline, 8000));
    if (res.status === 200 && res.text.indexOf('#EXTM3U') === 0) return { url: first, text: res.text };

    var failed = res.status;
    for (var i = 0; i < chain.streams.length; i += 1) {
      var row = chain.streams[i] || {};
      if (!row.url || row.url === chain.mp.url) continue;
      if (now() >= deadline - 1200) break;
      var alt = buildPlaylistUrl(chain, row.url, langValue);
      var r2 = await requestText(alt, headers, left(deadline, 8000));
      if (r2.status === 200 && r2.text.indexOf('#EXTM3U') === 0) return { url: alt, text: r2.text };
      failed = failed + '/' + r2.status;
    }
    throw new Error('playlist HTTP ' + failed);
  }

  function parseMaster(text) {
    var lines = String(text || '').split(/\r?\n/);
    var variants = [];
    var audio = [];
    var subs = [];
    var encrypted = false;
    var pending = null;
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXT-X-KEY:') === 0) {
        if (line.indexOf('METHOD=NONE') < 0) encrypted = true;
        continue;
      }
      if (line.indexOf('#EXT-X-MEDIA:') === 0) {
        var type = (line.match(/TYPE=([A-Z]+)/) || [])[1] || '';
        var name = (line.match(/NAME="([^"]*)"/) || [])[1] || '';
        var lng = (line.match(/LANGUAGE="([^"]*)"/) || [])[1] || '';
        var uri = unescapeHtml((line.match(/URI="([^"]+)"/) || [])[1] || '');
        var isDefault = /DEFAULT=YES/.test(line);
        if (type === 'AUDIO') audio.push({ name: clean(name), language: lng, uri: uri, isDefault: isDefault });
        else if (type === 'SUBTITLES') subs.push({ name: clean(name), language: lng, uri: uri, isDefault: isDefault });
        continue;
      }
      if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
        var res = line.match(/RESOLUTION=(\d+)x(\d+)/);
        var bw = (line.match(/BANDWIDTH=(\d+)/) || [])[1];
        pending = {
          height: res ? Number(res[2]) : 0,
          width: res ? Number(res[1]) : 0,
          bandwidth: bw ? Number(bw) : 0
        };
        continue;
      }
      if (line.charAt(0) === '#') continue;
      if (pending) {
        pending.url = line;
        variants.push(pending);
        pending = null;
      }
    }
    variants.sort(function (a, b) { return (b.height || 0) - (a.height || 0); });
    return { variants: variants, audio: audio, subs: subs, encrypted: encrypted };
  }

  async function verifyVariant(masterUrl, variant, headers, deadline) {
    var vurl = absoluteFrom(variant.url, masterUrl);
    var res = await requestText(vurl, headers, left(deadline, 6000));
    if (res.status !== 200 || res.text.indexOf('#EXTM3U') !== 0) throw new Error('variant HTTP ' + res.status);
    var lines = res.text.split(/\r?\n/);
    var segLine = '';
    for (var i = 0; i < lines.length; i += 1) {
      var l = lines[i].trim();
      if (l && l.charAt(0) !== '#') { segLine = l; break; }
    }
    if (!segLine) throw new Error('variant has no segments');
    var segUrl = absoluteFrom(segLine, vurl);
    var probe = await requestText(segUrl, Object.assign({}, headers, { Range: 'bytes=0-1' }), left(deadline, 6000));
    if (probe.status !== 200 && probe.status !== 206) throw new Error('segment HTTP ' + probe.status);
    return true;
  }

  async function resolveSubtitles(subs, headers, deadline) {
    var targets = [];
    var seenUri = {};
    for (var i = 0; i < subs.length; i += 1) {
      var entry = subs[i];
      if (!entry || !entry.uri || seenUri[entry.uri]) continue;
      seenUri[entry.uri] = true;
      targets.push(entry);
    }
    if (!targets.length) return [];

    var resolved = await mapPool(targets, 4, async function (track) {
      if (now() >= deadline - 1200) return null;
      try {
        var pl = await requestText(track.uri, headers, left(deadline, 5000));
        if (pl.status !== 200 || pl.text.indexOf('#EXTM3U') !== 0) return null;
        var lines = pl.text.split(/\r?\n/);
        var file = '';
        for (var k = 0; k < lines.length; k += 1) {
          var l = lines[k].trim();
          if (l && l.charAt(0) !== '#') { file = l; break; }
        }
        if (!file || !/\.vtt(\?|$)/i.test(file)) return null;
        var url = absoluteFrom(file, track.uri);
        return { label: track.name || 'Subtitle', language: shortLang(track.language), url: url };
      } catch (_) { return null; }
    });

    var found = [];
    for (var r = 0; r < resolved.length; r += 1) if (resolved[r]) found.push(resolved[r]);

    /* Byte-probe a bounded, language-prioritised slice (en, then it, then first
     * tracks in master order). Probing every track on 40-language titles would
     * double the request count for no added confidence. */
    var probeIdx = [];
    var prio = ['en', 'it'];
    for (var p = 0; p < prio.length; p += 1) {
      for (var f = 0; f < found.length && probeIdx.length < 4; f += 1) {
        if (found[f].language === prio[p] && probeIdx.indexOf(f) < 0) probeIdx.push(f);
      }
    }
    for (var g = 0; g < found.length && probeIdx.length < 4; g += 1) {
      if (probeIdx.indexOf(g) < 0) probeIdx.push(g);
    }
    var probeOk = {};
    await mapPool(probeIdx, 4, async function (idx) {
      if (now() >= deadline - 800) { probeOk[idx] = true; return true; }
      try {
        var res = await requestText(found[idx].url, { 'User-Agent': UA, 'Referer': VIX + '/' }, left(deadline, 4000));
        var ok = (res.status === 200 || res.status === 206) && res.text.indexOf('WEBVTT') === 0;
        probeOk[idx] = ok;
        return ok;
      } catch (_) { probeOk[idx] = false; return false; }
    });

    var out = [];
    for (var q = 0; q < found.length; q += 1) {
      if (probeIdx.indexOf(q) >= 0 && probeOk[q] === false) continue;
      out.push({
        id: found[q].url,
        url: found[q].url,
        file: found[q].url,
        label: found[q].label,
        language: found[q].language,
        lang: found[q].language,
        kind: 'subtitle',
        headers: { 'User-Agent': UA, 'Referer': VIX + '/' }
      });
    }
    return out;
  }

  async function extractStreamUrl(episodeHref, lang) {
    var deadline = now() + 16000;
    var ref = parseWatchRef(episodeHref);
    var requestLang = String(lang == null ? '' : lang).toLowerCase() || 'sub';
    var emptyResult = function (message) {
      return { streams: [], subtitles: [], lang: requestLang, error: { message: message } };
    };
    if (!ref) return emptyResult('StreamingUnity: invalid episode id or URL');

    var chain = null;
    var lastError = '';
    for (var attempt = 0; attempt < 2 && now() < deadline - 4000; attempt += 1) {
      try {
        chain = await vixChain(ref, deadline);
        if (chain) break;
      } catch (e) { lastError = String((e && e.message) || e); }
    }
    if (!chain) return emptyResult('StreamingUnity: no player data' + (lastError ? ' (' + lastError + ')' : ''));

    var headers = { 'User-Agent': UA, 'Referer': chain.src };
    var master = null;
    for (var pass = 0; pass < 2 && !master; pass += 1) {
      try {
        master = await fetchMaster(chain, chain.embedLang || LOCALE, deadline);
      } catch (e) {
        lastError = String((e && e.message) || e);
        if (pass === 0 && now() < deadline - 5000) {
          try { chain = await vixChain(ref, deadline); } catch (_) {}
        }
      }
    }
    if (!master) return emptyResult('StreamingUnity: stream unavailable' + (lastError ? ' (' + lastError + ')' : ''));

    var parsed = parseMaster(master.text);

    /* Verify the lowest variant end-to-end (playlist + first segment). */
    var variants = [];
    for (var v = 0; v < parsed.variants.length; v += 1) {
      if (parsed.variants[v] && parsed.variants[v].url) variants.push(parsed.variants[v]);
    }
    var verified = false;
    if (variants.length) {
      try {
        await verifyVariant(master.url, variants[variants.length - 1], headers, deadline);
        verified = true;
      } catch (e) { lastError = String((e && e.message) || e); }
    }
    if (!verified) return emptyResult('StreamingUnity: media segments failed verification' + (lastError ? ' (' + lastError + ')' : ''));

    var subs = await resolveSubtitles(parsed.subs, headers, deadline);

    /* Audio-language handling: built ONLY from the master's actual renditions. */
    var primaryAudio = 'und';
    for (var a = 0; a < parsed.audio.length; a += 1) {
      if (parsed.audio[a].isDefault) { primaryAudio = shortLang(parsed.audio[a].language); break; }
    }
    if (primaryAudio === 'und' && parsed.audio.length) primaryAudio = shortLang(parsed.audio[0].language);

    var italianFirst = (requestLang === 'dub' || requestLang === 'it' || requestLang === 'ita');
    var orderedLangs = [];
    var seenLang = {};
    var considerLang = function (code) {
      if (!code || code === 'und' || seenLang[code]) return;
      seenLang[code] = true;
      orderedLangs.push(code);
    };
    considerLang(primaryAudio);
    for (var a2 = 0; a2 < parsed.audio.length; a2 += 1) considerLang(shortLang(parsed.audio[a2].language));
    if (italianFirst && seenLang.it) {
      orderedLangs = ['it'].concat(orderedLangs.filter(function (x) { return x !== 'it'; }));
    }

    /* Wanted audio: 'dub' -> Italian, 'sub' -> the original, which is the first
     * non-Italian rendition this master actually offers (en/fr/ko/...). */
    var nonItalian = '';
    for (var a3 = 0; a3 < orderedLangs.length; a3 += 1) {
      if (orderedLangs[a3] !== 'it') { nonItalian = orderedLangs[a3]; break; }
    }
    var prefLang = italianFirst ? (seenLang.it ? 'it' : primaryAudio) : (nonItalian || primaryAudio);

    var defaultLangOf = function (m) {
      var def = 'und';
      for (var d = 0; d < m.audio.length; d += 1) {
        if (m.audio[d].isDefault) { def = shortLang(m.audio[d].language); break; }
      }
      if (def === 'und' && m.audio.length) def = shortLang(m.audio[0].language);
      return def;
    };

    /* Switch the playlist's default rendition to the wanted language. The
     * embed's own `lang` param is only the starting point: for guests it can
     * point at the Italian dub, which used to leak into 'sub' playback. */
    var primaryMaster = master;
    var primaryLang = primaryAudio;
    if (prefLang && prefLang !== primaryAudio) {
      try {
        var altMaster = await fetchMaster(chain, prefLang, deadline);
        if (defaultLangOf(parseMaster(altMaster.text)) === prefLang) {
          primaryMaster = altMaster;
          primaryLang = prefLang;
        }
      } catch (_) { /* keep the embed-language master */ }
    }

    /* The other language stays available as a second switchable stream. */
    var extraMaster = null;
    var extraLang = '';
    if (now() < deadline - 3000) {
      for (var a4 = 0; a4 < orderedLangs.length; a4 += 1) {
        if (orderedLangs[a4] === primaryLang) continue;
        try {
          var extraTry = await fetchMaster(chain, orderedLangs[a4], deadline);
          if (defaultLangOf(parseMaster(extraTry.text)) === orderedLangs[a4]) {
            extraMaster = extraTry;
            extraLang = orderedLangs[a4];
          }
        } catch (_) { extraMaster = null; }
        break;
      }
    }

    function langNameFor(code) {
      for (var i2 = 0; i2 < parsed.audio.length; i2 += 1) {
        if (shortLang(parsed.audio[i2].language) === code && parsed.audio[i2].name) return parsed.audio[i2].name;
      }
      return langLabel(code);
    }

    /* The app routes the Sub/Dub choice by stream label (module contract: the
     * labels should contain 'sub'/'dub'), so every pair carries the token that
     * matches the audio it actually plays, plus the readable language name. */
    function streamLabel(langCode) {
      var token = langCode === 'it' ? 'dub' : (langCode === 'und' ? (italianFirst ? 'dub' : 'sub') : 'sub');
      return token + ' ' + langNameFor(langCode);
    }

    var qualities = [{ label: 'Auto', url: primaryMaster.url, headers: headers }];
    for (var q = 0; q < variants.length; q += 1) {
      if (!variants[q].height) continue;
      qualities.push({
        label: variants[q].height + 'p',
        height: variants[q].height,
        url: absoluteFrom(variants[q].url, primaryMaster.url),
        headers: headers
      });
    }

    var primaryLabel = streamLabel(primaryLang);
    var streamPairs = [primaryLabel, primaryMaster.url];
    var serverRows = [{
      name: primaryLabel,
      label: primaryLabel,
      url: primaryMaster.url,
      headers: headers,
      streamType: 'hls',
      lang: primaryLang === 'it' ? 'dub' : 'sub',
      audioLanguage: primaryLang,
      subtitles: subs,
      qualities: qualities.slice(1)
    }];
    if (extraMaster) {
      var extraLabel = streamLabel(extraLang);
      streamPairs.push(extraLabel, extraMaster.url);
      serverRows.push({
        name: extraLabel,
        label: extraLabel,
        url: extraMaster.url,
        headers: headers,
        streamType: 'hls',
        lang: extraLang === 'it' ? 'dub' : 'sub',
        audioLanguage: extraLang,
        subtitles: subs
      });
    }

    return {
      url: primaryMaster.url,
      headers: headers,
      streamType: 'hls',
      streams: streamPairs,
      qualities: qualities,
      quality: 'Auto',
      defaultQuality: 'Auto',
      subtitles: subs,
      servers: serverRows,
      lang: requestLang,
      audioLanguage: primaryLang,
      audioLanguages: orderedLangs,
      provider: 'vixcloud'
    };
  }

  /* ============================================================= DISCOVERY */

  function slidersFrom(dp, name) {
    var list = dp && dp.props && dp.props.sliders;
    if (!Array.isArray(list)) return [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].name === name) return list[i].titles || [];
    }
    return [];
  }

  function safeGet(url, deadline, cap) {
    return requestText(url, HTML_HEADERS, left(deadline, cap || 6000)).then(
      function (r) { return r; },
      function () { return null; }
    );
  }

  async function discoveryHome() {
    var deadline = now() + 7500;
    var parts = await Promise.all([
      safeGet(SITE + '/' + LOCALE, deadline, 6000),
      safeGet(SITE + '/' + LOCALE + '/movies', deadline, 6000),
      safeGet(SITE + '/' + LOCALE + '/tv-shows', deadline, 6000)
    ]);
    var homePage = parts[0] && parts[0].status === 200 ? extractDataPage(parts[0].text) : null;
    var moviesPage = parts[1] && parts[1].status === 200 ? extractDataPage(parts[1].text) : null;
    var tvPage = parts[2] && parts[2].status === 200 ? extractDataPage(parts[2].text) : null;

    var trending = cardsFrom(slidersFrom(homePage, 'trending'), true);
    var top10 = cardsFrom(slidersFrom(homePage, 'top10'), true);
    var latest = cardsFrom(slidersFrom(homePage, 'latest'), false);
    var movies = cardsFrom(slidersFrom(moviesPage, 'trending'), false);
    var tv = cardsFrom(slidersFrom(tvPage, 'trending'), false);

    var used = {};
    var dedupe = function (list, cap) {
      var out = [];
      for (var i = 0; i < list.length && out.length < cap; i += 1) {
        var key = String(list[i].href || '').trim();
        if (!key || used[key]) continue;
        used[key] = true;
        out.push(list[i]);
      }
      return out;
    };

    /* Reserve the ranked Top-10 items first so that row keeps its exact ten
     * after the app's cross-section dedupe; the hero row is then filtered
     * against the reservation, so no section loses items. Sections are emitted
     * with the hero (Trending) row first and the Top 10 row second. */
    var top10Items = dedupe(top10, 10);
    var trendingItems = dedupe(trending, 8);
    var latestItems = dedupe(latest, 30);
    var moviesItems = dedupe(movies, 30);
    var tvItems = dedupe(tv, 30);

    var sections = [];
    var push = function (id, title, style, items, feedId) {
      if (!items.length) return;
      var section = { id: id, title: title, style: style, items: items };
      if (feedId) section.viewAll = { mode: 'feed', feedId: feedId };
      sections.push(section);
    };

    push('trending', 'Trending Now', 'hero', trendingItems, 'trending');
    push('top10', 'Top 10 Today', 'top10', top10Items, 'top10');
    push('latest', 'Recently Added', 'poster', latestItems, 'latest');
    push('movies', 'Movies', 'poster', moviesItems, 'movies');
    push('tv', 'TV Shows', 'poster', tvItems, 'tv');

    return { sections: sections };
  }

  async function discoveryFeed(feedId, page) {
    var deadline = now() + 9500;
    var feed = String(feedId == null ? '' : feedId).trim().toLowerCase();
    var pageNum = Math.max(1, Number(page) || 1);

    /* Paged catalogue feeds: mirror the site's own infinite-scroll endpoint.
     * GET /en/browse/<trending|latest>?lang=en&page=N[&type=tv|movie] answers
     * JSON {name,label,titles:[..]} with 60 items per page (verified pages
     * 1..3 disjoint). The site's own player stops paging when a page returns
     * fewer than 60 items, so hasMore mirrors that exact rule. */
    if (feed === 'trending' || feed === 'latest' || feed === 'movies' || feed === 'tv') {
      var listName = feed === 'latest' ? 'latest' : 'trending';
      var typeParam = feed === 'movies' ? '&type=movie' : (feed === 'tv' ? '&type=tv' : '');
      var jsonUrl = SITE + '/' + LOCALE + '/browse/' + listName + '?lang=' + encodeURIComponent(LOCALE) + '&page=' + pageNum + typeParam;
      try {
        var jr = await requestText(jsonUrl, JSON_HEADERS, left(deadline, 8000));
        if (jr.status === 200) {
          var payload = null;
          try { payload = JSON.parse(jr.text); } catch (_parse) { payload = null; }
          var rawArr = payload && (Array.isArray(payload.titles) ? payload.titles : (Array.isArray(payload.data) ? payload.data : null));
          if (rawArr) {
            var jitems = cardsFrom(rawArr);
            return { items: jitems.slice(0, 50), page: pageNum, hasMore: rawArr.length >= 60 };
          }
        }
      } catch (_json) { /* fall back to the HTML page below */ }
    }

    if (feed === 'trending' || feed === 'latest') {
      var res = await requestText(SITE + '/' + LOCALE + '/browse/' + feed + '?page=' + pageNum, HTML_HEADERS, left(deadline, 9000));
      if (res.status !== 200) throw new Error('StreamingUnity feed HTTP ' + res.status);
      var dp = extractDataPage(res.text);
      var raw = (dp && dp.props && dp.props.titles) || [];
      var items = cardsFrom(raw);
      return { items: items.slice(0, 50), page: pageNum, hasMore: raw.length >= 60 };
    }

    if (pageNum > 1) return { items: [], page: pageNum, hasMore: false };

    if (feed === 'top10') {
      var home = await requestText(SITE + '/' + LOCALE, HTML_HEADERS, left(deadline, 6000));
      if (home.status !== 200) throw new Error('StreamingUnity home HTTP ' + home.status);
      var top = cardsFrom(slidersFrom(extractDataPage(home.text), 'top10'));
      return { items: top.slice(0, 10), page: 1, hasMore: false };
    }

    if (feed === 'movies' || feed === 'tv') {
      var url = SITE + '/' + LOCALE + (feed === 'movies' ? '/movies' : '/tv-shows');
      var pageRes = await requestText(url, HTML_HEADERS, left(deadline, 6000));
      if (pageRes.status !== 200) throw new Error('StreamingUnity page HTTP ' + pageRes.status);
      var list = cardsFrom(slidersFrom(extractDataPage(pageRes.text), 'trending'));
      return { items: list.slice(0, 30), page: 1, hasMore: false };
    }

    return { items: [], page: pageNum, hasMore: false };
  }

  /* ================================================================ EXPORTS */

  globalThis.searchResults = searchResults;
  globalThis.extractDetails = extractDetails;
  globalThis.extractEpisodes = extractEpisodes;
  globalThis.extractStreamUrl = extractStreamUrl;
  globalThis.discoveryHome = discoveryHome;
  globalThis.discoveryFeed = discoveryFeed;
})();
