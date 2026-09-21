/* 新旧图自动配对。
   线索从强到弱：图像指纹 > 文件名 > 图片尺寸 > 上传顺序。
   每一对都会给出「依据」和「可信度」，不会假装百分百确定。 */
(function (global) {
  'use strict';

  function norm(name) {
    return String(name || '').toLowerCase().replace(/\.[^.]{1,6}$/, '').replace(/[^a-z0-9一-龥]+/g, '');
  }

  function score(o, n, oi, ni, total) {
    var s = 0, why = [];

    /* 1. 图像指纹 —— 最硬的证据 */
    if (o.hash && n.hash) {
      var d = Img.hamming(o.hash, n.hash);
      if (d <= 4) { s += 120; why.push('图像内容一致'); }
      else if (d <= 10) { s += 50; why.push('图像内容接近'); }
      else if (d >= 18) { s -= 80; why.push('图像内容不同'); }
    }

    /* 2. 文件名 */
    var on = norm(o.filename), nn = norm(n.filename);
    if (on && nn) {
      if (on === nn) { s += 60; why.push('文件名相同'); }
      else if (on.length >= 4 && nn.indexOf(on) >= 0) { s += 50; why.push('文件名包含'); }
      else if (nn.length >= 4 && on.indexOf(nn) >= 0) { s += 45; why.push('文件名包含'); }
      else {
        var seq = U.pad(oi + 1, 3);
        if (nn.indexOf(seq) >= 0) { s += 38; why.push('序号对上'); }
      }
    }

    /* 3. 尺寸 —— 不受跨域限制，拿得到就很有用 */
    if (o.w && o.h && n.w && n.h) {
      if (o.w === n.w && o.h === n.h) { s += 30; why.push('尺寸相同'); }
      else { s -= 70; why.push('尺寸不同'); }
    }

    /* 4. 顺序 */
    if (oi === ni) { s += 15; why.push('顺序对应'); }
    else if (Math.abs(oi - ni) <= 1) { s += 4; }

    return { s: s, why: why };
  }

  function level(s) {
    if (s >= 115) return 'high';
    if (s >= 50) return 'mid';
    return 'low';
  }
  var LABEL = { high: '高', mid: '中', low: '低', manual: '手动' };

  /**
   * auto(olds, news) -> { pairs: {oldId -> {ni, score, why, conf}}, pool: [ni...] }
   * olds/news 元素需要有 filename / w / h / hash（能拿到多少算多少）
   */
  function auto(olds, news) {
    var cand = [];
    olds.forEach(function (o, oi) {
      news.forEach(function (n, ni) {
        var r = score(o, n, oi, ni, Math.max(olds.length, news.length));
        cand.push({ oi: oi, ni: ni, s: r.s, why: r.why });
      });
    });
    cand.sort(function (a, b) { return b.s - a.s || (a.oi - a.ni) - (b.oi - b.ni); });

    var usedO = {}, usedN = {}, pairs = {};
    cand.forEach(function (c) {
      if (usedO[c.oi] || usedN[c.ni]) return;
      if (c.s < 20) return;                       // 太弱的先不认
      usedO[c.oi] = usedN[c.ni] = 1;
      pairs[olds[c.oi].id] = {
        ni: c.ni, score: c.s, why: c.why.slice(0, 2),
        conf: level(c.s)
      };
    });

    /* 剩下的按顺序兜底补上，明确标成「低」 */
    var freeO = [], freeN = [];
    olds.forEach(function (o, i) { if (!usedO[i]) freeO.push(i); });
    news.forEach(function (n, i) { if (!usedN[i]) freeN.push(i); });
    var k = Math.min(freeO.length, freeN.length);
    for (var i = 0; i < k; i++) {
      pairs[olds[freeO[i]].id] = {
        ni: freeN[i], score: 0, why: ['仅按顺序推测'], conf: 'low'
      };
      usedN[freeN[i]] = 1;
    }

    var pool = [];
    news.forEach(function (n, i) { if (!usedN[i]) pool.push(i); });
    return { pairs: pairs, pool: pool };
  }

  global.Match = { auto: auto, level: level, LABEL: LABEL, norm: norm };
})(window);
