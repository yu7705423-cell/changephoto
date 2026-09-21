/* 图片相关：探活 / 取二进制 / 算指纹 */
(function (global) {
  'use strict';

  var Img = {};
  var relay = { url: '', token: '' };

  Img.setRelay = function (url, token) {
    relay.url = (url || '').trim().replace(/\/+$/, '');
    relay.token = (token || '').trim();
  };
  Img.hasRelay = function () { return !!relay.url; };
  Img.relayInfo = function () { return relay; };

  Img.relayFetchUrl = function (target) {
    if (!relay.url) return null;
    var u = relay.url + '/fetch?url=' + encodeURIComponent(target);
    if (relay.token) u += '&key=' + encodeURIComponent(relay.token);
    return u;
  };

  /* 探活：用 <img> 加载，不受跨域限制，顺便拿到原始宽高 */
  Img.probe = function (url, timeout) {
    return new Promise(function (resolve) {
      if (!url) return resolve({ ok: false, reason: '链接无法解析' });
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        img.src = '';
        resolve({ ok: false, reason: '超时' });
      }, timeout || 20000);
      img.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: '加载失败' });
      };
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.src = url;
    });
  };

  /* 取二进制。优先走中转（能绕跨域和防盗链），没配就浏览器直抓 */
  Img.fetchBlob = function (url) {
    if (!url) return Promise.resolve({ ok: false, error: '链接无法解析' });
    if (/^data:/i.test(url)) {
      return fetch(url).then(function (r) { return r.blob(); })
        .then(function (b) { return { ok: true, blob: b, via: 'data' }; })
        .catch(function (e) { return { ok: false, error: '内嵌图片解析失败' }; });
    }

    var viaRelay = Img.relayFetchUrl(url);
    var attempt = viaRelay
      ? fetch(viaRelay, { cache: 'no-store' }).then(check('中转'))
      : fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer', cache: 'no-store' }).then(check('直抓'));

    return attempt.catch(function (e) {
      // 直抓失败且配了中转就再试中转；反之给出明确原因
      if (!viaRelay) {
        return { ok: false, error: '跨域被拦（对方没开 CORS）—— 配一个 Worker 中转就能取到' };
      }
      return { ok: false, error: String(e.message || e) };
    });

    function check(via) {
      return function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var msg = 'HTTP ' + r.status;
            if (/NoSuchKey|not\s*found/i.test(t)) msg += '（源站上这张图已经不存在了）';
            else if (r.status === 403) msg += '（防盗链或没权限）';
            return { ok: false, error: msg, status: r.status };
          }, function () { return { ok: false, error: 'HTTP ' + r.status, status: r.status }; });
        }
        return r.blob().then(function (b) {
          if (!b.size) return { ok: false, error: '返回了空文件' };
          return { ok: true, blob: b, via: via, type: b.type };
        });
      };
    }
  };

  /* dHash：缩到 9x8 灰度，比较左右相邻像素，得到 64 位指纹 */
  function hashFromBitmapSource(src, w, h) {
    var W = 9, H = 8;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(src, 0, 0, W, H);
    var data;
    try { data = ctx.getImageData(0, 0, W, H).data; }
    catch (e) { return null; }   // 画布被跨域污染，读不了像素
    var bits = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W - 1; x++) {
        var i = (y * W + x) * 4, j = (y * W + x + 1) * 4;
        var a = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        var b = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
        bits += (a > b ? '1' : '0');
      }
    }
    return bits;
  }

  Img.hashFromBlob = function (blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var hash = null;
        try { hash = hashFromBitmapSource(img, img.naturalWidth, img.naturalHeight); } catch (e) {}
        resolve({ hash: hash, w: img.naturalWidth, h: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { resolve({ hash: null }); URL.revokeObjectURL(url); };
      img.src = url;
    });
  };

  /* 直接从链接算指纹：先试 crossOrigin，不行再退回二进制（通常要中转） */
  Img.hashFromUrl = function (url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      var settled = false;
      var timer = setTimeout(function () { finishFallback(); }, 20000);
      img.onload = function () {
        if (settled) return;
        clearTimeout(timer);
        var hash = null;
        try { hash = hashFromBitmapSource(img); } catch (e) {}
        if (hash) {
          settled = true;
          resolve({ hash: hash, w: img.naturalWidth, h: img.naturalHeight, via: 'cors' });
        } else finishFallback(img.naturalWidth, img.naturalHeight);
      };
      img.onerror = function () { clearTimeout(timer); finishFallback(); };
      img.src = url;

      function finishFallback(w, h) {
        if (settled) return;
        settled = true;
        Img.fetchBlob(url).then(function (r) {
          if (!r.ok) return resolve({ hash: null, w: w || 0, h: h || 0, reason: r.error });
          return Img.hashFromBlob(r.blob).then(function (x) {
            resolve({ hash: x.hash, w: x.w || w || 0, h: x.h || h || 0, blob: r.blob, via: 'blob' });
          });
        });
      }
    });
  };

  Img.hamming = function (a, b) {
    if (!a || !b || a.length !== b.length) return 999;
    var d = 0;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  };

  global.Img = Img;
})(window);
