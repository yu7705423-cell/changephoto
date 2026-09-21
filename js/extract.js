/* 从 HTML / CSS / Markdown / 纯文本里把图片链接挖出来
   —— 记录每处出现的字符区间，导出时按区间原样替换，不会误伤别的文字 */
(function (global) {
  'use strict';

  var TAG_RE = /<([a-zA-Z][-\w:]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  var ATTR_RE = /([-\w:.]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+))/g;
  var CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi;
  var MD_RE = /!\[[^\]]*\]\(\s*<?([^)\s<>]+)>?/g;
  var BARE_RE = /https?:\/\/[^\s"'<>(){}[\]|\\^`]+/gi;

  /* 这些属性只要在对的标签上，值就当图片收 */
  var LAZY_ATTRS = [
    'data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-actualsrc',
    'data-echo', 'data-url', 'data-image', 'data-bg', 'data-background',
    'data-background-image', 'data-thumb', 'data-large', 'data-origin', 'data-hi-res-src'
  ];
  var IMG_TAGS = { img: 1, source: 1, image: 1, 'amp-img': 1, input: 1 };
  var SKIP_SRC_TAGS = { script: 1, iframe: 1, frame: 1, embed: 1, audio: 1, track: 1 };

  function accept(tag, attr, value) {
    attr = attr.toLowerCase();
    tag = tag.toLowerCase();
    if (!value || /^(#|javascript:|mailto:|tel:|\{\{|\{%|\$\{)/i.test(value.trim())) return false;
    if (LAZY_ATTRS.indexOf(attr) >= 0) {
      return U.looksLikeImage(value) || /^(https?:)?\/\//.test(value) || /^\.{0,2}\//.test(value);
    }
    if (attr === 'src' || attr === 'lowsrc') {
      if (SKIP_SRC_TAGS[tag]) return false;
      if (IMG_TAGS[tag]) return true;
      return U.looksLikeImage(value);
    }
    if (attr === 'poster') return tag === 'video';
    if (attr === 'href' || attr === 'xlink:href') {
      if (tag === 'image' || tag === 'use') return true;      // SVG
      if (tag === 'a' || tag === 'link') return U.looksLikeImage(value);
      return false;
    }
    if (attr === 'content') return tag === 'meta' && U.looksLikeImage(value);
    return false;
  }

  function isSrcset(attr) {
    attr = attr.toLowerCase();
    return attr === 'srcset' || attr === 'data-srcset' || attr === 'imagesrcset';
  }

  /* 把 raw 解析成能用的绝对链接；解不出来返回 null */
  function resolve(raw, base) {
    raw = raw.trim();
    if (!raw) return null;
    if (/^data:/i.test(raw)) return raw;
    if (/^blob:/i.test(raw)) return raw;
    try {
      if (/^https?:\/\//i.test(raw)) return new URL(raw).href;
      if (/^\/\//.test(raw)) {
        var scheme = base && /^http:/i.test(base) ? 'http:' : 'https:';
        return new URL(scheme + raw).href;
      }
      if (base) return new URL(raw, base).href;
    } catch (e) { /* 落到下面 */ }
    return null;
  }

  /**
   * extract(source, opts) -> { items, total, unresolved }
   * items[i] = { id, url, raw, kind, status, occurrences:[{start,end}] }
   */
  function extract(source, opts) {
    opts = opts || {};
    var base = (opts.baseUrl || '').trim();
    var mask = new Uint8Array(source.length);   // 标记已被认领的字符，防止重复提取
    var hits = [];                               // { start, end, raw, kind }

    function claim(start, end) {
      for (var i = start; i < end; i++) mask[i] = 1;
    }
    function taken(start, end) {
      for (var i = start; i < end; i++) if (mask[i]) return true;
      return false;
    }
    function push(start, end, raw, kind) {
      if (start < 0 || end > source.length || end <= start) return;
      if (taken(start, end)) return;
      claim(start, end);
      hits.push({ start: start, end: end, raw: raw, kind: kind });
    }

    /* --- 1. 标签属性（带标签上下文，才能区分 <img src> 和 <script src>） --- */
    var m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(source)) !== null) {
      var tag = m[1];
      var attrsText = m[2] || '';
      var attrsBase = m.index + 1 + tag.length;
      var am;
      ATTR_RE.lastIndex = 0;
      while ((am = ATTR_RE.exec(attrsText)) !== null) {
        var attr = am[1];
        var val, offInMatch;
        if (am[2] !== undefined) { val = am[2]; offInMatch = am[0].indexOf('"') + 1; }
        else if (am[3] !== undefined) { val = am[3]; offInMatch = am[0].indexOf("'") + 1; }
        else { val = am[4] || ''; offInMatch = am[0].length - val.length; }
        if (!val) continue;
        var valStart = attrsBase + am.index + offInMatch;

        if (isSrcset(attr)) {
          // "a.png 1x, b.png 2x" —— 每个候选单独记区间
          var cursor = 0;
          val.split(',').forEach(function (part) {
            var partStart = cursor;
            cursor += part.length + 1;
            var lead = part.length - part.replace(/^\s+/, '').length;
            var body = part.trim();
            if (!body) return;
            var urlPart = body.split(/\s+/)[0];
            if (!urlPart) return;
            push(valStart + partStart + lead, valStart + partStart + lead + urlPart.length,
                 urlPart, 'srcset');
          });
          continue;
        }
        if (accept(tag, attr, val)) {
          push(valStart, valStart + val.length, val, tag.toLowerCase() + '[' + attr.toLowerCase() + ']');
        }
      }
    }

    /* --- 2. CSS 的 url(...)，同时覆盖 <style> 块和 style="" 行内样式 --- */
    CSS_URL_RE.lastIndex = 0;
    while ((m = CSS_URL_RE.exec(source)) !== null) {
      var raw = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
      if (!raw) continue;
      var off = m[0].indexOf(raw, 3);
      if (off < 0) continue;
      var s = m.index + off;
      // url() 里的东西默认都当资源收，但排掉字体之类
      if (/\.(woff2?|ttf|otf|eot|mp4|webm|css|js)(?=$|[?#])/i.test(raw.split('#')[0])) continue;
      push(s, s + raw.length, raw, 'css');
    }

    /* --- 3. Markdown 图片 --- */
    MD_RE.lastIndex = 0;
    while ((m = MD_RE.exec(source)) !== null) {
      var mu = m[1];
      var mo = m[0].lastIndexOf(mu);
      push(m.index + mo, m.index + mo + mu.length, mu, 'markdown');
    }

    /* --- 4. 正文里裸着的图片链接 --- */
    BARE_RE.lastIndex = 0;
    while ((m = BARE_RE.exec(source)) !== null) {
      var bu = m[0].replace(/[.,;:!)]+$/, '');
      if (!U.looksLikeImage(bu)) continue;
      push(m.index, m.index + bu.length, bu, 'text');
    }

    /* --- 合并同一个链接的多处出现 --- */
    hits.sort(function (a, b) { return a.start - b.start; });
    var byUrl = {}, items = [], unresolved = 0, seq = 0;

    hits.forEach(function (h) {
      var decoded = U.decodeEntities(h.raw).trim();
      var url = resolve(decoded, base);
      var key = url || ('!rel!' + decoded);
      if (!url) unresolved++;
      if (!byUrl[key]) {
        byUrl[key] = {
          id: 'i' + (seq++),
          url: url,
          raw: decoded,
          kind: h.kind,
          resolved: !!url,
          isData: /^data:/i.test(decoded),
          occurrences: [],
          status: 'unknown',
          w: 0, h: 0,
          blob: null, hash: null, newUrl: '', size: 0
        };
        items.push(byUrl[key]);
      }
      byUrl[key].occurrences.push({ start: h.start, end: h.end });
    });

    items.forEach(function (it, i) { it.index = i + 1; });
    return { items: items, total: hits.length, unresolved: unresolved };
  }

  /* 按记录的区间把旧链接换成新链接，从后往前替换保证下标不串位 */
  function replaceAll(source, items) {
    var edits = [];
    items.forEach(function (it) {
      if (!it.newUrl || it.newUrl === it.url) return;
      it.occurrences.forEach(function (o) {
        edits.push({ start: o.start, end: o.end, text: it.newUrl });
      });
    });
    edits.sort(function (a, b) { return b.start - a.start; });
    var out = source;
    edits.forEach(function (e) {
      out = out.slice(0, e.start) + e.text + out.slice(e.end);
    });
    return { text: out, count: edits.length };
  }

  global.Extractor = { extract: extract, replaceAll: replaceAll, resolve: resolve };
})(window);
