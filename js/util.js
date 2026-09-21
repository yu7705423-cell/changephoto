/* 通用小工具 —— 无依赖，classic script，双击 index.html 也能跑 */
(function (global) {
  'use strict';

  var U = {};

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  U.el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  };

  U.escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* 用 textarea 解 HTML 实体：&amp; -> &，不会执行任何东西 */
  var _dec = document.createElement('textarea');
  U.decodeEntities = function (s) {
    if (s.indexOf('&') === -1) return s;
    _dec.innerHTML = s;
    return _dec.value;
  };

  U.fmtBytes = function (n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };

  U.pad = function (n, w) {
    var s = String(n);
    while (s.length < (w || 3)) s = '0' + s;
    return s;
  };

  /* 并发池：limit 个一起跑，每完成一个回调一次进度 */
  U.pool = function (items, limit, worker, onProgress) {
    return new Promise(function (resolve) {
      var idx = 0, done = 0, out = new Array(items.length);
      var n = Math.min(limit, items.length);
      if (!items.length) return resolve(out);
      function next() {
        var i = idx++;
        if (i >= items.length) return;
        Promise.resolve()
          .then(function () { return worker(items[i], i); })
          .then(function (r) { out[i] = r; }, function (e) { out[i] = { error: e }; })
          .then(function () {
            done++;
            if (onProgress) onProgress(done, items.length);
            if (done === items.length) resolve(out); else next();
          });
      }
      for (var k = 0; k < n; k++) next();
    });
  };

  U.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  U.store = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem('cp:' + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('cp:' + k, JSON.stringify(v)); } catch (e) {}
    },
    del: function (k) { try { localStorage.removeItem('cp:' + k); } catch (e) {} }
  };

  var toastTimer = null;
  U.toast = function (msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  };

  U.saveBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  U.copyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () { U.toast('已复制'); })
        .catch(function () { U.copyFallback(text); });
    }
    U.copyFallback(text);
    return Promise.resolve();
  };
  U.copyFallback = function (text) {
    var ta = U.el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); U.toast('已复制'); }
    catch (e) { U.toast('复制失败，请手动选中'); }
    ta.remove();
  };

  var IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svgz?|ico|tiff?|heic|heif|jfif)(?=$|[?#])/i;
  U.IMG_EXT = IMG_EXT;
  U.looksLikeImage = function (u) {
    if (!u) return false;
    if (/^data:image\//i.test(u)) return true;
    var clean = u.split('#')[0];
    if (IMG_EXT.test(clean)) return true;
    // 没有后缀但一看就是图床 / 图片服务的
    return /(\/image[s]?\/|\/img\/|\/photo[s]?\/|\/upload[s]?\/|imgbb|sm\.ms|smms|jsdelivr|imgur|cloudinary|unsplash|picsum|gravatar|qpic\.cn|sinaimg|bytedance|alicdn|format=(jpe?g|png|webp))/i.test(u);
  };

  /* 从链接里猜文件名 */
  U.nameFromUrl = function (u, fallbackIdx) {
    var name = '';
    if (/^data:/i.test(u)) {
      var m = /^data:([\w.+-]+)\/([\w.+-]+)/i.exec(u);
      name = 'inline.' + (m ? m[2].replace('svg+xml', 'svg') : 'bin');
    } else {
      try {
        var p = (u.split('#')[0].split('?')[0]).split('/');
        name = decodeURIComponent(p[p.length - 1] || '');
      } catch (e) { name = ''; }
    }
    name = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
    if (!name) name = 'image' + (fallbackIdx || '');
    return name;
  };

  U.extFromType = function (type) {
    if (!type) return '';
    var map = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
      'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
      'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
      'image/tiff': 'tiff', 'image/heic': 'heic'
    };
    return map[String(type).split(';')[0].toLowerCase().trim()] || '';
  };

  /* 去掉扩展名 */
  U.stem = function (name) { return String(name).replace(/\.[^.]{1,6}$/, ''); };

  U.shorten = function (u, n) {
    u = String(u);
    n = n || 60;
    if (u.length <= n) return u;
    return u.slice(0, Math.ceil(n * 0.6)) + '…' + u.slice(-Math.floor(n * 0.35));
  };

  U.blobToBase64 = function (blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.readAsDataURL(blob);
    });
  };

  U.readText = function (file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.readAsText(file);
    });
  };

  global.U = U;
})(window);
