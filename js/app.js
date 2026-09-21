/* 主程序：把提取 / 下载 / 上传 / 对照 / 导出串起来 */
(function () {
  'use strict';

  var $ = U.$, $$ = U.$$, el = U.el;

  var state = {
    source: '',
    sourceName: 'code.html',
    items: [],
    cmp: null,          // { olds, news, rows }
    picked: null,       // { type:'pool'|'row', i }
    failed: [],
    hostId: U.store.get('hostId', 'github')
  };

  /* ============ 标签页 ============ */
  function switchTab(panelId) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.panel === panelId); });
    $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === panelId); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('#tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.tab');
    if (t) switchTab(t.dataset.panel);
  });

  /* ============ 进度条 ============ */
  function progress(box, done, total, label) {
    if (!box) return;
    box.hidden = false;
    var pct = total ? Math.round(done / total * 100) : 0;
    box.querySelector('.bar').style.width = pct + '%';
    box.querySelector('.ptext').textContent = (label || '') + ' ' + done + ' / ' + total;
  }
  function hideProgress(box) { if (box) box.hidden = true; }

  function log(boxId, msg, cls) {
    var box = $('#' + boxId);
    if (!box) return;
    box.appendChild(el('div', { class: cls || '', text: msg }));
    box.scrollTop = box.scrollHeight;
  }

  /* ============ 1. 输入 ============ */
  $('#file').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    Promise.all(files.map(U.readText)).then(function (texts) {
      $('#src').value = texts.join('\n\n/* ---- ' + files.map(function (f) { return f.name; }).join(' | ') + ' ---- */\n\n');
      state.sourceName = files[0].name;
      updateSrcInfo();
      U.toast('已读入 ' + files.length + ' 个文件');
    }).catch(function (err) { U.toast(err.message); });
  });

  $('#btn-clear-src').addEventListener('click', function () {
    $('#src').value = '';
    updateSrcInfo();
  });

  $('#btn-sample').addEventListener('click', function () {
    $('#src').value = [
      '<div class="gallery">',
      '  <img src="https://picsum.photos/id/1015/600/400" alt="河">',
      '  <img src="https://picsum.photos/id/1025/400/400" alt="狗">',
      '  <img data-src="https://picsum.photos/id/1039/800/300" src="https://picsum.photos/id/1039/800/300">',
      '  <img srcset="https://picsum.photos/id/1043/300/200 1x, https://picsum.photos/id/1043/600/400 2x">',
      '</div>',
      '<style>',
      '  .hero { background-image: url("https://picsum.photos/id/1050/900/300"); }',
      '  .gone { background: url(https://example.invalid/已经失效的图.png); }',
      '</style>'
    ].join('\n');
    state.sourceName = 'sample.html';
    updateSrcInfo();
  });

  $('#src').addEventListener('input', updateSrcInfo);
  function updateSrcInfo() {
    var n = $('#src').value.length;
    $('#src-info').textContent = n ? ('当前 ' + n.toLocaleString() + ' 个字符') : '';
  }

  /* 中转设置 */
  function loadRelay() {
    var r = U.store.get('relay', { url: '', token: '' });
    $('#relay-url').value = r.url || '';
    $('#relay-token').value = r.token || '';
    applyRelay();
    if (r.url) $('#relay-box').open = true;
  }
  function applyRelay() {
    var url = $('#relay-url').value.trim(), token = $('#relay-token').value.trim();
    Img.setRelay(url, token);
    U.store.set('relay', { url: url, token: token });
  }
  $('#relay-url').addEventListener('change', applyRelay);
  $('#relay-token').addEventListener('change', applyRelay);

  $('#btn-test-relay').addEventListener('click', function () {
    applyRelay();
    var s = $('#relay-status');
    if (!Img.hasRelay()) { s.textContent = '还没填地址'; return; }
    s.textContent = '测试中…';
    var r = Img.relayInfo();
    fetch(r.url + '/ping' + (r.token ? '?key=' + encodeURIComponent(r.token) : ''))
      .then(function (res) { return res.text().then(function (t) { return { ok: res.ok, status: res.status, t: t }; }); })
      .then(function (o) {
        if (o.ok) {
          var j = null; try { j = JSON.parse(o.t); } catch (e) {}
          s.textContent = '✅ 通了' + (j && j.r2 ? '，R2 存储桶已绑定' : '，未绑定 R2（只能中转取图）');
        } else if (o.status === 401) s.textContent = '❌ 口令不对';
        else s.textContent = '❌ HTTP ' + o.status;
      })
      .catch(function () { s.textContent = '❌ 连不上，检查地址是否正确、Worker 是否已部署'; });
  });

  /* ============ 提取 ============ */
  $('#btn-extract').addEventListener('click', function () {
    var src = $('#src').value;
    if (!src.trim()) { U.toast('先把代码贴进来 owo'); return; }
    applyRelay();
    state.source = src;
    var r = Extractor.extract(src, { baseUrl: $('#base-url').value.trim() });
    if (!r.items.length) {
      U.toast('没找到图片链接，确认一下代码里有没有图？');
      return;
    }
    r.items.forEach(function (it) {
      it.sel = true;
      it.filename = U.pad(it.index, 3) + '-' + U.nameFromUrl(it.url || it.raw, it.index);
    });
    state.items = r.items;
    state.cmp = null;
    $('#tab-count').textContent = r.items.length;
    $('#images-empty').hidden = true;
    $('#images-main').hidden = false;
    $('#upload-box').hidden = true;
    renderGrid();
    switchTab('panel-images');

    var extra = [];
    if (r.unresolved) extra.push(r.unresolved + ' 处是相对路径，填上「基准地址」才能还原');
    U.toast('找到 ' + r.items.length + ' 张图（共出现 ' + r.total + ' 处）' + (extra.length ? '；' + extra.join('；') : ''));
    probeAll();
  });

  /* ============ 2. 图片网格 ============ */
  function statusBadge(it) {
    if (!it.resolved) return { cls: 'warn', text: '相对路径' };
    if (it.isData) return { cls: 'new', text: '内嵌图片' };
    if (it.status === 'ok') return { cls: 'ok', text: (it.w && it.h) ? (it.w + '×' + it.h) : '可加载' };
    if (it.status === 'dead') return { cls: 'dead', text: '已失效' };
    return { cls: 'wait', text: '检测中…' };
  }

  function renderGrid() {
    var grid = $('#grid');
    grid.textContent = '';
    var hideDead = $('#filter-dead').checked;
    state.items.forEach(function (it) {
      if (hideDead && it.status === 'dead') return;
      grid.appendChild(cellFor(it));
    });
    updateStat();
  }

  function cellFor(it) {
    var b = statusBadge(it);
    var thumb = el('div', { class: 'thumb' });
    if (it.url) {
      var img = el('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: it.url });
      img.addEventListener('error', function () { thumb.textContent = ''; thumb.appendChild(el('div', { class: 'fail', text: '× 打不开' })); });
      thumb.appendChild(img);
      thumb.addEventListener('click', function () { lightbox(it.url); });
    } else {
      thumb.appendChild(el('div', { class: 'fail', text: '无法解析' }));
    }

    var chk = el('input', { type: 'checkbox', class: 'pick' });
    chk.checked = !!it.sel;
    chk.addEventListener('change', function () { it.sel = chk.checked; updateStat(); });

    var acts = el('div', { class: 'acts' }, [
      el('button', { class: 'btn tiny', text: '下载', onclick: function () { downloadOne(it); } }),
      el('button', { class: 'btn tiny', text: '复制链接', onclick: function () { U.copyText(it.url || it.raw); } })
    ]);

    return el('div', { class: 'cell', 'data-id': it.id }, [
      chk,
      el('span', { class: 'no', text: U.pad(it.index, 3) }),
      thumb,
      el('div', { class: 'info' }, [
        el('span', { class: 'badge ' + b.cls, text: b.text }),
        el('span', { class: 'u', title: it.url || it.raw, text: U.shorten(it.url || it.raw, 70) }),
        acts
      ])
    ]);
  }

  function refreshCell(it) {
    var old = $('.cell[data-id="' + it.id + '"]');
    if (!old) return;
    if ($('#filter-dead').checked && it.status === 'dead') { old.remove(); return; }
    var fresh = cellFor(it);
    old.replaceWith(fresh);
  }

  function updateStat() {
    var n = state.items.length;
    var ok = state.items.filter(function (i) { return i.status === 'ok'; }).length;
    var dead = state.items.filter(function (i) { return i.status === 'dead'; }).length;
    var sel = state.items.filter(function (i) { return i.sel; }).length;
    $('#img-stat').textContent = '共 ' + n + ' 张 · 能加载 ' + ok + ' · 已失效 ' + dead + ' · 已选 ' + sel;
    $('#upload-count').textContent = sel;
  }

  function probeAll() {
    var list = state.items.filter(function (i) { return i.resolved; });
    list.forEach(function (i) { if (!i.isData) i.status = 'unknown'; });
    U.pool(list, 6, function (it) {
      if (it.isData) { it.status = 'ok'; }
      return Img.probe(it.url).then(function (r) {
        it.status = r.ok ? 'ok' : 'dead';
        it.w = r.w || 0; it.h = r.h || 0;
        it.deadReason = r.reason || '';
        refreshCell(it);
      });
    }, function (d, t) {
      $('#img-stat').textContent = '检测中 ' + d + ' / ' + t + '…';
    }).then(function () {
      updateStat();
      var dead = state.items.filter(function (i) { return i.status === 'dead'; }).length;
      if (dead) U.toast('检测完成，有 ' + dead + ' 张已经失效了 TT');
    });
  }

  $('#btn-recheck').addEventListener('click', probeAll);
  $('#filter-dead').addEventListener('change', renderGrid);
  $('#btn-sel-all').addEventListener('click', function () { setSel(function () { return true; }); });
  $('#btn-sel-none').addEventListener('click', function () { setSel(function () { return false; }); });
  $('#btn-sel-ok').addEventListener('click', function () { setSel(function (i) { return i.status === 'ok'; }); });
  function setSel(fn) {
    state.items.forEach(function (i) { i.sel = fn(i); });
    $$('.cell').forEach(function (c) {
      var it = byId(c.dataset.id);
      if (it) c.querySelector('.pick').checked = !!it.sel;
    });
    updateStat();
  }
  function byId(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }
  function selected() {
    var s = state.items.filter(function (i) { return i.sel && i.resolved; });
    return s.length ? s : state.items.filter(function (i) { return i.resolved; });
  }

  /* ============ 取二进制（带缓存） ============ */
  function ensureBlob(it) {
    if (it.blob) return Promise.resolve({ ok: true, blob: it.blob });
    return Img.fetchBlob(it.url).then(function (r) {
      if (r.ok) { it.blob = r.blob; it.size = r.blob.size; }
      return r;
    });
  }

  function finalName(it, blob) {
    var name = it.filename;
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
      var ext = U.extFromType(blob && blob.type) || 'png';
      name += '.' + ext;
    }
    return name;
  }

  function downloadOne(it) {
    U.toast('正在取…');
    ensureBlob(it).then(function (r) {
      if (r.ok) { U.saveBlob(r.blob, finalName(it, r.blob)); U.toast('已保存'); }
      else {
        U.toast('取不到：' + r.error);
        if (it.url) window.open(it.url, '_blank', 'noopener');
      }
    });
  }

  /* ============ 打包 ZIP ============ */
  $('#btn-zip').addEventListener('click', function () {
    var list = selected();
    if (!list.length) { U.toast('没有可下载的图'); return; }
    var btn = this;
    btn.disabled = true;
    var box = $('#dl-progress');
    $('#dl-log').textContent = '';
    var files = [], bad = [];

    U.pool(list, 4, function (it) {
      return ensureBlob(it).then(function (r) {
        if (!r.ok) { bad.push({ it: it, why: r.error }); log('dl-log', '✕ ' + it.filename + '：' + r.error, 'e'); return; }
        return r.blob.arrayBuffer().then(function (buf) {
          files.push({ name: finalName(it, r.blob), data: new Uint8Array(buf), it: it });
        });
      });
    }, function (d, t) { progress(box, d, t, '取图'); })
      .then(function () {
        if (!files.length) {
          U.toast('一张都没取到 TT 多半是跨域被拦了，配个 Worker 中转试试');
          return;
        }
        files.sort(function (a, b) { return a.it.index - b.it.index; });
        var csv = '﻿序号,文件名,原始链接,状态\n' + files.map(function (f) {
          return [U.pad(f.it.index, 3), q(f.name), q(f.it.url), f.it.status === 'ok' ? '正常' : '可疑'].join(',');
        }).join('\n');
        if (bad.length) {
          csv += '\n' + bad.map(function (b) {
            return [U.pad(b.it.index, 3), '(没取到)', q(b.it.url), q(b.why)].join(',');
          }).join('\n');
        }
        var zipFiles = files.map(function (f) { return { name: f.name, data: f.data }; });
        zipFiles.push({ name: '清单.csv', data: csv });
        zipFiles.push({
          name: '说明.txt',
          data: '这些图按 001、002… 的顺序编号了。\r\n' +
                '按同样的顺序传到新图床，拿回来的链接多半也是同一个顺序，\r\n' +
                '回到工具的「对照」标签把新链接一行一个粘进去，就能自动配对。\r\n' +
                '（工具还会用文件名、图片尺寸、图像指纹交叉验证，不会只靠顺序）\r\n'
        });
        U.saveBlob(Zip.build(zipFiles), U.stem(state.sourceName) + '-图片.zip');
        U.toast('打包好了：' + files.length + ' 张' + (bad.length ? '，' + bad.length + ' 张没取到' : ''));
      })
      .then(function () { btn.disabled = false; hideProgress(box); });

    function q(s) {
      s = String(s == null ? '' : s);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
  });

  /* ============ 3. 转存到图床 ============ */
  $('#btn-upload-open').addEventListener('click', function () {
    $('#upload-box').hidden = false;
    $('#upload-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function initHostSelect() {
    var sel = $('#host');
    Object.keys(Hosts).forEach(function (id) {
      sel.appendChild(el('option', { value: id, text: Hosts[id].name }));
    });
    sel.value = state.hostId in Hosts ? state.hostId : 'github';
    sel.addEventListener('change', function () {
      state.hostId = sel.value;
      U.store.set('hostId', sel.value);
      renderHostFields();
    });
    renderHostFields();
  }

  function renderHostFields() {
    var host = Hosts[$('#host').value];
    $('#host-note').textContent = host.note || '';
    var box = $('#host-fields');
    box.textContent = '';
    var saved = U.store.get('cfg:' + $('#host').value, {});
    (host.fields || []).forEach(function (f) {
      var val = saved[f.key] !== undefined ? saved[f.key] : (f.value !== undefined ? f.value : '');
      if (f.type === 'checkbox') {
        var cb = el('input', { type: 'checkbox', 'data-key': f.key });
        cb.checked = !!val;
        box.appendChild(el('label', { class: 'chk', style: 'display:flex;margin:10px 0' }, [cb, document.createTextNode(' ' + f.label)]));
        return;
      }
      var input;
      if (f.type === 'select') {
        input = el('select', { 'data-key': f.key });
        f.options.forEach(function (o) { input.appendChild(el('option', { value: o.value, text: o.label })); });
        input.value = val;
      } else {
        input = el('input', {
          type: f.type || 'text', 'data-key': f.key,
          placeholder: f.placeholder || '', value: val
        });
      }
      box.appendChild(el('div', { class: 'field' }, [
        el('label', { text: f.label + (f.required ? ' *' : '') }), input
      ]));
    });
    $('#remember-token').checked = !!U.store.get('remember', false);
  }

  function readCfg() {
    var cfg = {};
    $$('#host-fields [data-key]').forEach(function (n) {
      cfg[n.dataset.key] = n.type === 'checkbox' ? n.checked : n.value.trim();
    });
    return cfg;
  }

  $('#remember-token').addEventListener('change', function () {
    U.store.set('remember', this.checked);
    if (!this.checked) Object.keys(Hosts).forEach(function (id) { U.store.del('cfg:' + id); });
  });

  $('#btn-forget').addEventListener('click', function () {
    Object.keys(Hosts).forEach(function (id) { U.store.del('cfg:' + id); });
    U.store.set('remember', false);
    renderHostFields();
    U.toast('已清除本机保存的图床配置');
  });

  $('#btn-upload-start').addEventListener('click', function () {
    var list = selected();
    if (!list.length) { U.toast('先选几张图'); return; }
    startUpload(list);
  });
  $('#btn-upload-retry').addEventListener('click', function () {
    if (!state.failed.length) return;
    startUpload(state.failed.slice());
  });

  function startUpload(list) {
    var hostId = $('#host').value;
    var host = Hosts[hostId];
    var cfg = readCfg();

    var missing = (host.fields || []).filter(function (f) { return f.required && !cfg[f.key]; });
    if (missing.length) { U.toast('还差：' + missing.map(function (f) { return f.label; }).join('、')); return; }
    if (host.needsRelay && !Img.hasRelay()) { U.toast('这个图床要先在「输入」里配好 Worker 中转地址'); return; }
    if ($('#remember-token').checked) U.store.set('cfg:' + hostId, cfg);

    var btn = $('#btn-upload-start');
    btn.disabled = true;
    $('#btn-upload-retry').hidden = true;
    $('#upload-log').textContent = '';
    state.failed = [];
    var okCount = 0;
    var box = $('#upload-progress');
    log('upload-log', '开始上传到 ' + host.name + '，共 ' + list.length + ' 张');

    var conc = host.throttle ? 1 : 3;
    U.pool(list, conc, function (it) {
      return ensureBlob(it)
        .then(function (r) {
          if (!r.ok) throw new Error('取不到原图：' + r.error);
          return host.upload(r.blob, finalName(it, r.blob), cfg);
        })
        .then(function (res) {
          it.newUrl = res.url;
          okCount++;
          log('upload-log', '✓ ' + U.pad(it.index, 3) + ' → ' + res.url + (res.note ? '（' + res.note + '）' : ''), 's');
          if (host.throttle) return U.sleep(host.throttle);
        })
        .catch(function (e) {
          state.failed.push(it);
          log('upload-log', '✕ ' + U.pad(it.index, 3) + ' ' + U.shorten(it.url, 50) + ' —— ' + (e.message || e), 'e');
        });
    }, function (d, t) { progress(box, d, t, '上传'); })
      .then(function () {
        btn.disabled = false;
        $('#btn-upload-retry').hidden = !state.failed.length;
        $('#btn-upload-retry').textContent = '重试失败的 ' + state.failed.length + ' 张';
        log('upload-log', '完成：成功 ' + okCount + ' 张，失败 ' + state.failed.length + ' 张');
        U.toast('上传完成：成功 ' + okCount + '，失败 ' + state.failed.length);
        if (okCount) {
          buildCompareFromUpload();
          $('#btn-load-uploaded').disabled = false;
        }
      });
  }

  /* ============ 4. 对照 ============ */
  function mkNew(url) {
    return { url: url, filename: U.nameFromUrl(url), w: 0, h: 0, hash: null, status: 'unknown' };
  }

  /* 工具内直接传的，对应关系是确定的，不用猜 */
  function buildCompareFromUpload() {
    var olds = state.items.filter(function (i) { return i.newUrl; });
    if (!olds.length) return;
    var news = olds.map(function (o) { return mkNew(o.newUrl); });
    state.cmp = {
      olds: state.items.filter(function (i) { return i.resolved; }),
      news: news,
      rows: []
    };
    state.cmp.rows = state.cmp.olds.map(function (o) {
      var ni = olds.indexOf(o);
      return ni >= 0
        ? { ni: ni, manual: '', why: ['本工具直接上传，确定对应'], conf: 'high' }
        : { ni: -1, manual: '', why: [], conf: '' };
    });
    renderCompare(true);
    probeNews();
  }

  $('#btn-load-uploaded').addEventListener('click', function () {
    if (!state.items.some(function (i) { return i.newUrl; })) {
      U.toast('还没有上传结果');
      return;
    }
    buildCompareFromUpload();
    U.toast('已载入上传结果');
  });

  $('#btn-match').addEventListener('click', function () {
    var urls = $('#new-urls').value.split(/[\r\n,\s]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return /^(https?:)?\/\//i.test(s) || /^data:/i.test(s); });
    if (!urls.length) { U.toast('粘几个新链接进来吧 owo'); return; }
    if (!state.items.length) { U.toast('先在「输入」里提取旧图'); return; }
    state.cmp = {
      olds: selected(),
      news: urls.map(mkNew),
      rows: null
    };
    runAutoMatch(true);
  });

  $('#btn-rematch').addEventListener('click', function () { runAutoMatch(false); });

  function runAutoMatch(firstTime) {
    var cmp = state.cmp;
    if (!cmp) { U.toast('还没有可匹配的新链接'); return; }
    var useHash = $('#use-hash').checked;
    $('#match-info').textContent = '正在读取新图的尺寸…';

    probeNews()
      .then(function () {
        if (!useHash) return;
        $('#match-info').textContent = '正在算图像指纹…（读不到像素的会标成未验证）';
        return computeHashes();
      })
      .then(function () {
        var r = Match.auto(cmp.olds, cmp.news);
        cmp.rows = cmp.olds.map(function (o) {
          var p = r.pairs[o.id];
          return p ? { ni: p.ni, manual: '', why: p.why, conf: p.conf }
                   : { ni: -1, manual: '', why: [], conf: '' };
        });
        renderCompare(true);
        var high = cmp.rows.filter(function (x) { return x.conf === 'high'; }).length;
        var noHash = cmp.news.filter(function (n) { return useHash && !n.hash; }).length;
        $('#match-info').textContent = '匹配完成：' + high + ' 对可信度高' +
          (noHash ? '；有 ' + noHash + ' 张新图读不到像素（跨域），指纹未验证，走 Worker 中转可以解决' : '');
        if (firstTime) U.toast('匹配好了，往下看对照表 owo');
      });
  }

  function probeNews() {
    var cmp = state.cmp;
    var box = $('#cmp-progress');
    return U.pool(cmp.news, 6, function (n) {
      return Img.probe(n.url).then(function (r) {
        n.status = r.ok ? 'ok' : 'dead';
        n.w = r.w || 0; n.h = r.h || 0;
      });
    }, function (d, t) { progress(box, d, t, '检测新图'); }).then(function () { hideProgress(box); });
  }

  function computeHashes() {
    var cmp = state.cmp;
    var box = $('#cmp-progress');
    var jobs = [];
    cmp.olds.forEach(function (o) {
      if (o.hash || o.status !== 'ok') return;
      jobs.push(function () {
        var p = o.blob ? Img.hashFromBlob(o.blob) : Img.hashFromUrl(o.url);
        return p.then(function (r) {
          o.hash = r.hash;
          if (!o.w && r.w) { o.w = r.w; o.h = r.h; }
          if (r.blob && !o.blob) o.blob = r.blob;
        });
      });
    });
    cmp.news.forEach(function (n) {
      if (n.hash || n.status !== 'ok') return;
      jobs.push(function () {
        return Img.hashFromUrl(n.url).then(function (r) {
          n.hash = r.hash;
          if (!n.w && r.w) { n.w = r.w; n.h = r.h; }
        });
      });
    });
    return U.pool(jobs, 4, function (j) { return j(); },
      function (d, t) { progress(box, d, t, '算指纹'); })
      .then(function () { hideProgress(box); });
  }

  /* ---- 对照界面 ---- */
  /* goTab 只在刚建好对照表时传 true；平时重绘不跳标签也不滚动，
     不然每点一次交换页面就弹回顶部 */
  function renderCompare(goTab) {
    var cmp = state.cmp;
    $('#compare-main').hidden = false;
    var wrap = $('#pairs');
    wrap.textContent = '';
    cmp.rows.forEach(function (row, i) { wrap.appendChild(pairEl(cmp.olds[i], row, i)); });
    renderPool();
    var done = cmp.rows.filter(function (r) { return r.ni >= 0 || r.manual; }).length;
    $('#pair-stat').textContent = '共 ' + cmp.rows.length + ' 行 · 已配好 ' + done +
      ' · 待分配 ' + poolIdx().length;
    if (goTab) switchTab('panel-compare');
  }

  function poolIdx() {
    var used = {};
    state.cmp.rows.forEach(function (r) { if (r.ni >= 0) used[r.ni] = 1; });
    var out = [];
    state.cmp.news.forEach(function (n, i) { if (!used[i]) out.push(i); });
    return out;
  }

  function newUrlOf(row) {
    if (row.manual) return row.manual;
    if (row.ni >= 0) return state.cmp.news[row.ni].url;
    return '';
  }

  function pairEl(o, row, i) {
    /* 左：旧图 */
    var leftBox = el('div', { class: 'box' });
    if (o.localPreview) {
      leftBox.appendChild(imgEl(o.localPreview, false));
      leftBox.appendChild(zoomBtn(o.localPreview));
    } else if (o.status === 'dead' || !o.url) {
      leftBox.appendChild(el('div', { class: 'ph', html: '旧图已失效<br>看不到了 TT' }));
    } else {
      leftBox.appendChild(imgEl(o.url, false));
      leftBox.appendChild(zoomBtn(o.url));
    }
    var upBtn = el('label', { class: 'btn tiny', text: o.localPreview ? '换一张原图' : '上传原图对照' });
    var fin = el('input', { type: 'file', accept: 'image/*', hidden: true });
    fin.addEventListener('change', function () {
      if (!fin.files[0]) return;
      o.localPreview = URL.createObjectURL(fin.files[0]);
      o.blob = fin.files[0];
      renderCompare();
    });
    upBtn.appendChild(fin);

    var leftCap = el('div', { class: 'cap' }, [
      el('span', { class: 'badge ' + (o.status === 'ok' ? 'ok' : 'dead'),
                   text: U.pad(o.index, 3) + ' · ' + (o.w ? o.w + '×' + o.h : (o.status === 'dead' ? '已失效' : '?')) }),
      el('span', { class: 'capurl', title: o.url || o.raw, text: o.url || o.raw })
    ]);
    var left = el('div', { class: 'side' }, [leftBox, leftCap]);
    if (o.status === 'dead' && !o.localPreview) left.appendChild(upBtn);
    else if (o.localPreview) left.appendChild(upBtn);

    /* 中：依据 + 操作 */
    var confKey = row.manual ? 'manual' : row.conf;
    var mid = el('div', { class: 'mid' }, [
      el('span', { class: 'badge ' + (confKey ? 'conf-' + confKey : 'wait'),
                   text: confKey ? '可信度 ' + Match.LABEL[confKey] : '未配对' }),
      el('div', { class: 'why', text: row.manual ? '手动指定' : (row.why || []).join(' · ') }),
      el('div', { class: 'arrow', text: '→' }),
      el('div', { class: 'mbtns' }, [
        btn('↑', function () { move(i, -1); }),
        btn('↓', function () { move(i, 1); }),
        btn('解除', function () { row.ni = -1; row.manual = ''; row.why = []; row.conf = ''; renderCompare(); })
      ])
    ]);

    /* 右：新图 */
    var rightBox = el('div', { class: 'box slot' });
    var url = newUrlOf(row);
    if (url) {
      rightBox.appendChild(imgEl(url, false));
      rightBox.appendChild(zoomBtn(url));
    } else {
      rightBox.appendChild(el('div', { class: 'ph', html: '还没有新图<br><small>点这里，或先点下面的待分配图</small>' }));
    }
    if (state.picked && state.picked.type === 'row' && state.picked.i === i) rightBox.classList.add('picked');
    rightBox.addEventListener('click', function () { onSlotClick(i); });
    rightBox.addEventListener('dragover', function (ev) { ev.preventDefault(); rightBox.classList.add('picked'); });
    rightBox.addEventListener('dragleave', function () { rightBox.classList.remove('picked'); });
    rightBox.addEventListener('drop', function (ev) {
      ev.preventDefault();
      var ni = parseInt(ev.dataTransfer.getData('text/plain'), 10);
      if (!isNaN(ni)) assign(i, ni);
    });

    var n = row.ni >= 0 ? state.cmp.news[row.ni] : null;
    var rightCap = el('div', { class: 'cap' }, [
      el('span', { class: 'badge ' + (n && n.status === 'ok' ? 'ok' : (n ? 'dead' : 'wait')),
                   text: n ? (n.w ? n.w + '×' + n.h : (n.status === 'dead' ? '打不开' : '?')) : (row.manual ? '手动链接' : '—') }),
      el('span', { class: 'capurl', title: url || '', text: url || '' })
    ]);
    var urlin = el('input', { class: 'urlin', type: 'text', placeholder: '或直接粘一个链接覆盖这一行', value: row.manual || '' });
    urlin.addEventListener('change', function () {
      var v = urlin.value.trim();
      if (v) { row.manual = v; row.ni = -1; row.conf = 'manual'; }
      else { row.manual = ''; if (!row.conf) row.conf = ''; }
      renderCompare();
    });

    var right = el('div', { class: 'side' }, [rightBox, rightCap, urlin]);
    return el('div', { class: 'pair', 'data-i': i }, [left, mid, right]);

    function btn(t, fn) { return el('button', { class: 'btn tiny', text: t, onclick: fn }); }
  }

  /* zoomOnClick=false 时单击不弹大图 —— 对照页里单击是「选中 / 交换」，
     弹大图交给角上的小按钮，不然图占满格子就永远点不到格子本身了 */
  function imgEl(src, zoomOnClick) {
    var i = el('img', { src: src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    if (zoomOnClick !== false) {
      i.addEventListener('click', function (e) { e.stopPropagation(); lightbox(src); });
    }
    return i;
  }

  function zoomBtn(src) {
    return el('button', {
      class: 'zoom', title: '看大图', text: '⤢',
      onclick: function (e) { e.stopPropagation(); lightbox(src); }
    });
  }

  function renderPool() {
    var wrap = $('#pool');
    wrap.textContent = '';
    var idx = poolIdx();
    $('#pool-count').textContent = '(' + idx.length + ')';
    idx.forEach(function (ni) {
      var n = state.cmp.news[ni];
      var thumb = el('div', { class: 'thumb' }, [imgEl(n.url, false), zoomBtn(n.url)]);
      var cell = el('div', { class: 'cell' + (state.picked && state.picked.type === 'pool' && state.picked.i === ni ? ' picked' : ''), draggable: 'true' }, [
        thumb,
        el('div', { class: 'info' }, [
          el('span', { class: 'badge ' + (n.status === 'ok' ? 'ok' : 'dead'),
                       text: n.w ? n.w + '×' + n.h : (n.status === 'dead' ? '打不开' : '?') }),
          el('span', { class: 'u', text: U.shorten(n.url, 44) })
        ])
      ]);
      cell.addEventListener('click', function () { onPoolClick(ni); });
      cell.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', String(ni));
      });
      wrap.appendChild(cell);
    });
  }

  function onSlotClick(i) {
    var p = state.picked;
    if (p && p.type === 'pool') { assign(i, p.i); return; }
    if (p && p.type === 'row') {
      if (p.i === i) { state.picked = null; renderCompare(); return; }
      swap(p.i, i);
      return;
    }
    state.picked = { type: 'row', i: i };
    $('#pick-tip').textContent = '已选中第 ' + (i + 1) + ' 行的新图：再点另一行就交换，点下面的待分配图就换成那张。';
    renderCompare();
  }

  function onPoolClick(ni) {
    var p = state.picked;
    if (p && p.type === 'row') { assign(p.i, ni); return; }
    state.picked = (p && p.type === 'pool' && p.i === ni) ? null : { type: 'pool', i: ni };
    $('#pick-tip').textContent = state.picked
      ? '已选中一张待分配的新图：现在点某一行右边的格子，就分配过去。'
      : '点一张「待分配」的新图，再点某一行右边的格子，就分配过去了；点两行右边的格子可以互换。';
    renderCompare();
  }

  function assign(rowI, ni) {
    var rows = state.cmp.rows;
    rows.forEach(function (r) { if (r.ni === ni) { r.ni = -1; r.why = []; r.conf = ''; } });
    rows[rowI].ni = ni;
    rows[rowI].manual = '';
    rows[rowI].why = ['手动指定'];
    rows[rowI].conf = 'manual';
    state.picked = null;
    renderCompare();
  }

  function swap(a, b) {
    var rows = state.cmp.rows;
    var t = rows[a];
    rows[a] = rows[b];
    rows[b] = t;
    [a, b].forEach(function (k) {
      if (rows[k].ni >= 0 || rows[k].manual) { rows[k].why = ['手动交换']; rows[k].conf = 'manual'; }
    });
    state.picked = null;
    renderCompare();
  }

  function move(i, d) {
    var j = i + d;
    if (j < 0 || j >= state.cmp.rows.length) return;
    swap(i, j);
  }

  $('#btn-clear-pairs').addEventListener('click', function () {
    if (!state.cmp) return;
    state.cmp.rows.forEach(function (r) { r.ni = -1; r.manual = ''; r.why = []; r.conf = ''; });
    state.picked = null;
    renderCompare();
  });

  /* ============ 5. 导出 ============ */
  $('#btn-to-export').addEventListener('click', buildExport);

  function buildExport() {
    if (!state.cmp) { U.toast('还没有对照结果'); return; }
    state.items.forEach(function (i) { i.newUrl = ''; });
    var mapping = [];
    state.cmp.rows.forEach(function (row, i) {
      var o = state.cmp.olds[i];
      var nu = newUrlOf(row);
      if (!nu) return;
      o.newUrl = nu;
      mapping.push({
        no: U.pad(o.index, 3),
        old: o.url || o.raw,
        neu: nu,
        conf: Match.LABEL[row.manual ? 'manual' : (row.conf || 'low')] || '-',
        why: row.manual ? '手动指定' : (row.why || []).join(' · ')
      });
    });
    if (!mapping.length) { U.toast('还没有配好任何一对'); return; }

    var r = Extractor.replaceAll(state.source, state.items);
    state.mapping = mapping;
    state.outCode = r.text;

    $('#export-empty').hidden = true;
    $('#export-main').hidden = false;
    $('#table-main').hidden = false;
    $('#out-code').value = r.text;
    $('#replace-info').textContent = '替换了 ' + r.count + ' 处，涉及 ' + mapping.length + ' 张图。' +
      (state.items.length - mapping.length > 0
        ? '还有 ' + (state.items.length - mapping.length) + ' 张没配新链接，代码里保持原样。' : '');

    var t = $('#map-table');
    t.textContent = '';
    var head = el('tr', {}, ['序号', '可信度', '依据', '旧链接', '新链接'].map(function (h) {
      return el('th', { text: h });
    }));
    t.appendChild(el('thead', {}, [head]));
    var body = el('tbody');
    mapping.forEach(function (m) {
      body.appendChild(el('tr', {}, [
        el('td', { text: m.no }),
        el('td', { text: m.conf }),
        el('td', { text: m.why }),
        el('td', { text: m.old }),
        el('td', { text: m.neu })
      ]));
    });
    t.appendChild(body);
    switchTab('panel-export');
  }

  $('#btn-copy-code').addEventListener('click', function () { U.copyText($('#out-code').value); });
  $('#btn-dl-code').addEventListener('click', function () {
    var name = state.sourceName.replace(/(\.[^.]+)?$/, function (m) { return '-已替换' + (m || '.txt'); });
    U.saveBlob(new Blob([$('#out-code').value], { type: 'text/plain;charset=utf-8' }), name);
  });

  $('#table-main').addEventListener('click', function (e) {
    var b = e.target.closest('[data-fmt]');
    if (!b || !state.mapping) return;
    var fmt = b.dataset.fmt, text, mime = 'text/plain;charset=utf-8', ext = 'txt';
    if (fmt === 'csv') {
      text = '﻿序号,可信度,依据,旧链接,新链接\n' + state.mapping.map(function (m) {
        return [m.no, m.conf, m.why, m.old, m.neu].map(function (s) {
          s = String(s);
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',');
      }).join('\n');
      mime = 'text/csv;charset=utf-8'; ext = 'csv';
    } else if (fmt === 'md') {
      text = '| 序号 | 可信度 | 依据 | 旧链接 | 新链接 |\n|---|---|---|---|---|\n' +
        state.mapping.map(function (m) {
          return '| ' + [m.no, m.conf, m.why, m.old, m.neu].join(' | ') + ' |';
        }).join('\n');
      ext = 'md';
    } else {
      text = JSON.stringify(state.mapping.map(function (m) {
        return { no: m.no, old: m.old, new: m.neu, confidence: m.conf, reason: m.why };
      }), null, 2);
      mime = 'application/json'; ext = 'json';
    }
    if (fmt === 'copy') { U.copyText(text); return; }
    U.saveBlob(new Blob([text], { type: mime }), '链接对照表.' + ext);
  });

  /* ============ 大图预览 ============ */
  function lightbox(src) {
    if (!src) return;
    var lb = $('#lightbox');
    lb.querySelector('img').src = src;
    lb.hidden = false;
  }
  $('#lightbox').addEventListener('click', function (e) {
    if (e.target.tagName !== 'IMG') this.hidden = true;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') $('#lightbox').hidden = true;
  });

  /* ============ 日间 / 夜间 ============ */
  var THEMES = [
    { v: '', label: '跟随系统' },
    { v: 'light', label: '日间' },
    { v: 'dark', label: '夜间' }
  ];
  function applyTheme(v) {
    if (v) document.documentElement.setAttribute('data-theme', v);
    else document.documentElement.removeAttribute('data-theme');
    var cur = THEMES.filter(function (t) { return t.v === v; })[0] || THEMES[0];
    $('#theme-toggle').textContent = cur.label;
    U.store.set('theme', v);
  }
  $('#theme-toggle').addEventListener('click', function () {
    var now = U.store.get('theme', '');
    var i = THEMES.map(function (t) { return t.v; }).indexOf(now);
    applyTheme(THEMES[(i + 1) % THEMES.length].v);
  });

  $('#go-setup').addEventListener('click', function (e) {
    e.preventDefault();
    document.querySelector('.tab[data-panel="panel-setup"]').click();
  });

  /* ============ 启动 ============ */
  applyTheme(U.store.get('theme', ''));
  loadRelay();
  initHostSelect();
  updateSrcInfo();
  $('#btn-load-uploaded').disabled = true;
})();
