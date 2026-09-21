/* 主程序：把提取 / 下载 / 上传 / 对照 / 导出串起来 */
(function () {
  'use strict';

  var $ = U.$, $$ = U.$$, el = U.el;

  var state = {
    /* 代码文件可以有好几个（比如一次传一堆 css），各自独立提取、独立导出 */
    files: [{ name: '粘贴的代码.txt', text: '' }],
    curFile: 0,
    outs: [],
    curOut: 0,
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
    if (t) { switchTab(t.dataset.panel); scheduleSave(); }
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
  var CODE_EXT = /\.(html?|css|s[ac]ss|less|txt|markdown|md|json|xml|vue|[jt]sx?|php|astro|svelte)$/i;

  function isCodeFile(f) {
    return CODE_EXT.test(f.name) || (/^text\//.test(f.type) && !U.IMG_EXT.test(f.name));
  }

  /* 一次读进来一堆代码文件，各自保持独立，不合并成一坨 */
  function addCodeFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList || []).filter(isCodeFile);
    if (!arr.length) { U.toast('没挑出代码文件来 owo'); return; }
    arr.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    });
    Promise.all(arr.map(U.readText)).then(function (texts) {
      // 空的「粘贴的代码」占位就别留着了
      if (state.files.length === 1 && !state.files[0].text.trim()) state.files = [];
      var from = state.files.length;
      arr.forEach(function (f, i) { state.files.push({ name: f.name, text: texts[i] }); });
      state.curFile = from;
      renderFileTabs();
      showFile(from);
      U.toast('读入 ' + arr.length + ' 个文件，一共 ' + state.files.length + ' 个');
      scheduleSave();
    }).catch(function (err) { U.toast(err.message); });
  }

  $('#file').addEventListener('change', function (e) {
    addCodeFiles(e.target.files);
    e.target.value = '';
  });

  function renderFileTabs() {
    var box = $('#file-tabs');
    box.textContent = '';
    box.hidden = state.files.length < 2;
    if (box.hidden) return;
    state.files.forEach(function (f, i) {
      var tab = el('button', { class: 'ftab' + (i === state.curFile ? ' on' : '') }, [
        el('span', { class: 'fn', text: (i + 1) + '.' }),
        el('span', { class: 'fname', text: f.name, title: f.name }),
        el('span', { class: 'fx', text: '×', title: '移掉这个文件',
          onclick: function (ev) { ev.stopPropagation(); removeFile(i); } })
      ]);
      tab.addEventListener('click', function () { showFile(i); });
      box.appendChild(tab);
    });
  }

  function showFile(i) {
    if (i < 0 || i >= state.files.length) return;
    state.curFile = i;
    $('#src').value = state.files[i].text;
    renderFileTabs();
    updateSrcInfo();
  }

  function removeFile(i) {
    state.files.splice(i, 1);
    if (!state.files.length) state.files = [{ name: '粘贴的代码.txt', text: '' }];
    showFile(Math.min(state.curFile, state.files.length - 1));
    scheduleSave();
  }

  $('#btn-clear-src').addEventListener('click', function () {
    state.files = [{ name: '粘贴的代码.txt', text: '' }];
    state.curFile = 0;
    showFile(0);
    scheduleSave();
  });

  $('#btn-sample').addEventListener('click', function () {
    state.files = [{ name: 'sample.html', text: '' }];
    state.curFile = 0;
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
    state.files[0].text = $('#src').value;
    renderFileTabs();
    updateSrcInfo();
  });

  $('#src').addEventListener('input', function () {
    state.files[state.curFile].text = $('#src').value;
    updateSrcInfo();
    scheduleSave();
  });
  function updateSrcInfo() {
    var n = $('#src').value.length;
    var many = state.files.length > 1;
    $('#src-info').textContent = n
      ? (many ? '这个文件 ' : '当前 ') + n.toLocaleString() + ' 个字符' +
        (many ? '，一共 ' + state.files.length + ' 个文件、' +
                state.files.reduce(function (a, f) { return a + f.text.length; }, 0).toLocaleString() + ' 个字符' : '')
      : '';
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
  /* 每个文件单独提取，再按链接合并去重；每处出现都记住属于哪个文件 */
  function extractAll(baseUrl) {
    var byKey = {}, items = [], total = 0, unresolved = 0;
    state.files.forEach(function (f, fi) {
      if (!f.text.trim()) return;
      var r = Extractor.extract(f.text, { baseUrl: baseUrl });
      total += r.total;
      unresolved += r.unresolved;
      r.items.forEach(function (it) {
        it.occurrences.forEach(function (o) { o.f = fi; });
        var key = it.url || ('!rel!' + it.raw);
        if (byKey[key]) {
          byKey[key].occurrences = byKey[key].occurrences.concat(it.occurrences);
        } else {
          byKey[key] = it;
          items.push(it);
        }
      });
    });
    items.forEach(function (it, i) { it.id = 'i' + i; it.index = i + 1; });
    return { items: items, total: total, unresolved: unresolved };
  }

  $('#btn-extract').addEventListener('click', function () {
    state.files[state.curFile].text = $('#src').value;
    if (!state.files.some(function (f) { return f.text.trim(); })) {
      U.toast('先把代码贴进来 owo'); return;
    }
    applyRelay();
    var r = extractAll($('#base-url').value.trim());
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
    var nFiles = state.files.filter(function (f) { return f.text.trim(); }).length;
    U.toast('找到 ' + r.items.length + ' 张图（' +
            (nFiles > 1 ? nFiles + ' 个文件里共出现 ' : '共出现 ') + r.total + ' 处）' +
            (extra.length ? '；' + extra.join('；') : ''));
    $('#restore-bar').hidden = true;
    saveNow();
    probeAll();
  });

  /* ============ 直接传本机图片 ============
     不少人不是要搬家，就是手上一堆图想传到图床拿链接，给这条路留个入口。 */

  /* 本机文件的 blob: 地址刷新就失效，所以另外记一个稳定的缓存键 */
  function cacheKeyOf(it) { return it.isLocal ? it.localKey : it.url; }
  /* 本机文件显示原始文件名，别把 blob: 那串给用户看 */
  function srcLabel(it) { return it.isLocal ? it.raw : (it.url || it.raw); }

  function addLocalFiles(files) {
    var imgs = Array.prototype.slice.call(files || []).filter(function (f) {
      return /^image\//.test(f.type) || U.IMG_EXT.test(f.name);
    });
    if (!imgs.length) { U.toast('没挑出图片文件来 owo'); return; }
    // 按文件名排序，序号才跟你在文件管理器里看到的顺序一致
    imgs.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    });

    var base = state.items.length;
    var added = imgs.map(function (f, k) {
      var id = 'L' + Date.now().toString(36) + '-' + k;
      var idx = base + k + 1;
      return {
        id: id, isLocal: true, localKey: 'local:' + id,
        url: URL.createObjectURL(f), raw: f.name, kind: '本机文件',
        resolved: true, isData: false, occurrences: [],
        index: idx,
        filename: U.pad(idx, 3) + '-' + U.nameFromUrl(f.name, idx),
        status: 'ok', w: 0, h: 0,
        blob: f, size: f.size, hash: null, newUrl: '', sel: true
      };
    });

    state.items = state.items.concat(added);
    state.cmp = null;
    $('#tab-count').textContent = state.items.length;
    $('#images-empty').hidden = true;
    $('#images-main').hidden = false;
    $('#restore-bar').hidden = true;
    renderGrid();
    switchTab('panel-images');
    $('#local-info').textContent = '加了 ' + added.length + ' 张，一共 ' + state.items.length + ' 张';
    U.toast('加了 ' + added.length + ' 张图，去「转存到图床」就能传 owo');

    // 存进缓存，刷新后还能找回来；顺便量一下尺寸
    Promise.all(added.map(function (it) { return Store.putBlob(it.localKey, it.blob); }))
      .then(function () {
        return U.pool(added, 6, function (it) {
          return Img.probe(it.url).then(function (r) {
            it.w = r.w || 0; it.h = r.h || 0;
            if (!r.ok) { it.status = 'dead'; it.deadReason = '这个文件读不出来'; }
            refreshCell(it);
          });
        });
      })
      .then(function () { updateStat(); saveNow(); refreshCacheInfo(); });
  }

  $('#pick-imgs').addEventListener('change', function (e) {
    addLocalFiles(e.target.files);
    e.target.value = '';
  });
  $('#pick-dir').addEventListener('change', function (e) {
    addLocalFiles(e.target.files);
    e.target.value = '';
  });

  /* 拖进来 —— 整页都能接，不用非得对准那个框 */
  var dragDepth = 0;
  ['dragenter', 'dragover'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      e.preventDefault();
      if (ev === 'dragenter') { dragDepth++; document.body.classList.add('dragging'); }
      var zone = e.target.closest && e.target.closest('#drop');
      if (zone) zone.classList.add('over');
    });
  });
  document.addEventListener('dragleave', function () {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove('dragging');
      $('#drop').classList.remove('over');
    }
  });
  document.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    $('#drop').classList.remove('over');
    // 拖进来的可能是图片，也可能是 css / html —— 分开处理
    var all = Array.prototype.slice.call(e.dataTransfer.files);
    var imgs = all.filter(function (f) { return /^image\//.test(f.type) || U.IMG_EXT.test(f.name); });
    var code = all.filter(function (f) { return imgs.indexOf(f) < 0 && isCodeFile(f); });
    if (imgs.length) addLocalFiles(imgs);
    if (code.length) addCodeFiles(code);
    if (!imgs.length && !code.length) U.toast('这些文件我认不出来 owo');
  });

  /* 直接粘贴 —— 截图完 Ctrl+V 就能传 */
  document.addEventListener('paste', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
      // 在输入框里粘贴的，只有确实带了图片文件才拦下来
      var hasFile = e.clipboardData && e.clipboardData.files && e.clipboardData.files.length;
      if (!hasFile) return;
    }
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) {
      e.preventDefault();
      addLocalFiles(e.clipboardData.files);
    }
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
      el('button', { class: 'btn tiny', text: '复制链接',
                     onclick: function () { U.copyText(it.newUrl || srcLabel(it)); } })
    ]);

    return el('div', { class: 'cell', 'data-id': it.id }, [
      chk,
      el('span', { class: 'no', text: U.pad(it.index, 3) }),
      thumb,
      el('div', { class: 'info' }, [
        el('span', { class: 'badge ' + b.cls, text: b.text }),
        el('span', { class: 'u', title: srcLabel(it), text: U.shorten(it.newUrl || srcLabel(it), 70) }),
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
      scheduleSave();
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
    scheduleSave();
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
    // 先看本机缓存 —— 抓过一次就不用再抓，切走回来也还在
    var key = cacheKeyOf(it);
    return Store.getBlob(key).then(function (cached) {
      if (cached) {
        it.blob = cached;
        it.size = cached.size;
        return { ok: true, blob: cached, via: '缓存' };
      }
      if (it.isLocal) return { ok: false, error: '这个本机文件的缓存没了，重新选一次吧' };
      return Img.fetchBlob(it.url).then(function (r) {
        if (r.ok) {
          it.blob = r.blob;
          it.size = r.blob.size;
          Store.putBlob(key, r.blob);
        }
        return r;
      });
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
  /* ============ 保存到本地 ============
     手机上解压 ZIP 挺麻烦的，所以给了几种不用解压的方式，
     按设备能力自动推荐一个，ZIP 留着给电脑用。 */

  var CAN_SHARE = !!(navigator.share && navigator.canShare);
  var CAN_DIR = typeof window.showDirectoryPicker === 'function';
  var IS_TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  function initSaveBar() {
    var lines = [];
    if (CAN_SHARE) {
      $('#btn-share').hidden = false;
      lines.push('<b>分享 / 存到手机</b>：调系统分享面板，直接存进「文件」或相册，不用解压。' +
                 '存到「文件」会保留 001、002 的编号；存到相册会被系统重命名，' +
                 '不过之后配对靠顺序和图像指纹一样能对上。');
    }
    if (CAN_DIR) {
      $('#btn-dir').hidden = false;
      lines.push('<b>存到文件夹</b>：选一个文件夹，图片直接写进去，不用解压。');
    }
    lines.push('<b>逐张保存</b>：一张张下载，哪个浏览器都能用。手机上可能会先问「是否允许下载多个文件」，允许即可。');
    lines.push('<b>打包 ZIP</b>：一个文件装完，电脑上最省事，手机上要自己解压。');
    $('#save-hint').innerHTML = lines.join('<br>');
    var best = (IS_TOUCH && CAN_SHARE) ? '#btn-share' : (CAN_DIR ? '#btn-dir' : '#btn-zip');
    $(best).classList.add('primary');
  }

  function csvCell(v) {
    var t = String(v == null ? '' : v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  function buildManifest(files, bad) {
    var csv = '﻿序号,文件名,原始链接,状态\n' + files.map(function (f) {
      return [U.pad(f.it.index, 3), csvCell(f.name), csvCell(f.it.url),
              f.it.status === 'ok' ? '正常' : '可疑'].join(',');
    }).join('\n');
    (bad || []).forEach(function (b) {
      csv += '\n' + [U.pad(b.it.index, 3), '(没取到)', csvCell(b.it.url), csvCell(b.why)].join(',');
    });
    return csv;
  }

  var READ_ME =
    '这些图按 001、002… 的顺序编号了。\r\n' +
    '按同样的顺序传到新图床，拿回来的链接多半也是同一个顺序，\r\n' +
    '回到工具的「对照」标签把新链接一行一个粘进去，就能自动配对。\r\n' +
    '（工具还会用文件名、图片尺寸、图像指纹交叉验证，不会只靠顺序）\r\n';

  /* 把选中的图都取回来 */
  function collectBlobs(list) {
    var files = [], bad = [];
    var box = $('#dl-progress');
    $('#dl-log').textContent = '';
    return U.pool(list, 4, function (it) {
      return ensureBlob(it).then(function (r) {
        if (!r.ok) {
          bad.push({ it: it, why: r.error });
          log('dl-log', '✕ ' + it.filename + '：' + r.error, 'e');
          return;
        }
        files.push({ name: finalName(it, r.blob), blob: r.blob, it: it });
      });
    }, function (d, t) { progress(box, d, t, '取图'); })
      .then(function () {
        hideProgress(box);
        files.sort(function (a, b) { return a.it.index - b.it.index; });
        return { files: files, bad: bad };
      });
  }

  /* 四个保存按钮共用的外壳：查选中 → （可选的前置动作）→ 取图 → 各自保存 */
  function saveWith(btn, fn, before) {
    var list = selected();
    if (!list.length) { U.toast('没有可保存的图'); return; }
    btn.disabled = true;
    Promise.resolve()
      .then(function () { return before ? before() : true; })
      .then(function (pre) {
        if (pre === false) return;
        return collectBlobs(list).then(function (r) {
          if (!r.files.length) {
            U.toast('一张都没取到 TT 多半是跨域被拦了，配个 Worker 中转试试');
            return;
          }
          return fn(r);
        });
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return;     // 用户自己取消的，不用吵他
        U.toast('出错了：' + ((e && e.message) || e));
      })
      .then(function () { btn.disabled = false; hideProgress($('#dl-progress')); });
  }

  function doneToast(r, what) {
    U.toast(what + '：' + r.files.length + ' 张' +
            (r.bad.length ? '，' + r.bad.length + ' 张没取到（看上面的失败列表）' : ''));
  }

  /* ---- 打包 ZIP ---- */
  $('#btn-zip').addEventListener('click', function () {
    saveWith(this, function (r) {
      return Promise.all(r.files.map(function (f) {
        return f.blob.arrayBuffer().then(function (buf) {
          return { name: f.name, data: new Uint8Array(buf) };
        });
      })).then(function (entries) {
        entries.push({ name: '清单.csv', data: buildManifest(r.files, r.bad) });
        entries.push({ name: '说明.txt', data: READ_ME });
        U.saveBlob(Zip.build(entries), U.stem(state.files[0].name || 'code') + '-图片.zip');
        doneToast(r, '打包好了');
        refreshCacheInfo();
      });
    });
  });

  /* ---- 存到文件夹（电脑版 Chrome / Edge）---- */
  $('#btn-dir').addEventListener('click', function () {
    var dir = null;
    saveWith(this, function (r) {
      var box = $('#dl-progress'), i = 0;
      function write(name, data) {
        return dir.getFileHandle(name, { create: true })
          .then(function (fh) { return fh.createWritable(); })
          .then(function (w) {
            return Promise.resolve(w.write(data)).then(function () { return w.close(); });
          });
      }
      function next() {
        if (i >= r.files.length) {
          return write('清单.csv', new Blob([buildManifest(r.files, r.bad)], { type: 'text/csv' }))
            .then(function () { return write('说明.txt', new Blob([READ_ME], { type: 'text/plain' })); })
            .then(function () { doneToast(r, '已写进文件夹'); });
        }
        var f = r.files[i++];
        progress(box, i, r.files.length, '写入');
        return write(f.name, f.blob).then(next);
      }
      return next();
    }, function () {
      // 选文件夹必须紧跟着点击动作，所以放在取图之前
      return window.showDirectoryPicker({ mode: 'readwrite', id: 'image-mover' })
        .then(function (h) { dir = h; return true; });
    });
  });

  /* ---- 逐张保存 ---- */
  $('#btn-each').addEventListener('click', function () {
    saveWith(this, function (r) {
      var box = $('#dl-progress');
      return new Promise(function (resolve) {
        var i = 0;
        (function step() {
          if (i >= r.files.length) {
            U.saveBlob(new Blob([buildManifest(r.files, r.bad)], { type: 'text/csv;charset=utf-8' }), '清单.csv');
            doneToast(r, '保存完了');
            return resolve();
          }
          var f = r.files[i++];
          U.saveBlob(f.blob, f.name);
          progress(box, i, r.files.length, '保存');
          setTimeout(step, 400);      // 连着触发太快浏览器会当成滥用
        })();
      });
    });
  });

  /* ---- 分享到系统（手机上最省事）---- */
  $('#btn-share').addEventListener('click', function () {
    saveWith(this, function (r) {
      var fs = r.files.map(function (f) {
        return new File([f.blob], f.name, { type: f.blob.type || 'image/png' });
      });
      if (!navigator.canShare({ files: fs })) {
        // 多半是一次给太多了，二分找出这台手机最多肯收几张
        var lo = 1, hi = fs.length, best = 0;
        while (lo <= hi) {
          var mid = (lo + hi) >> 1;
          if (navigator.canShare({ files: fs.slice(0, mid) })) { best = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        if (!best) {
          U.toast('这个浏览器不接受分享图片文件，用「逐张保存」吧');
          return;
        }
        fs = fs.slice(0, best);
        U.toast('一次分享不了这么多，这次先分享前 ' + best + ' 张，剩下的取消勾选后再点一次');
      }
      return navigator.share({ files: fs })
        .then(function () { U.toast('分享完成：' + fs.length + ' 张'); })
        .catch(function (e) {
          if (e.name === 'AbortError') return;        // 用户自己取消
          if (e.name === 'NotAllowedError') {
            U.toast('图片是刚取回来的，手机要求分享必须紧跟着点击 —— 现在已经缓存好了，再点一次就行');
            return;
          }
          throw e;
        });
    });
  });

  /* ---- 只要清单，不要图 ---- */
  $('#btn-manifest').addEventListener('click', function () {
    var list = selected();
    if (!list.length) { U.toast('还没有图'); return; }
    var rows = list.map(function (it) { return { name: it.filename, it: it }; });
    U.saveBlob(new Blob([buildManifest(rows, [])], { type: 'text/csv;charset=utf-8' }), '清单.csv');
    U.toast('清单下好了');
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
        scheduleSave();
        refreshCacheInfo();
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
    /* 算指纹时顺手把取到的二进制也存进缓存 ——
       不然这条路等于绕过了缓存，刷新之后又得重抓一遍 */
    function take(target, r) {
      target.hash = r.hash;
      if (!target.w && r.w) { target.w = r.w; target.h = r.h; }
      if (r.blob) {
        if (!target.blob) target.blob = r.blob;
        Store.putBlob(target.localKey || target.url, r.blob);
      }
    }
    function hashOf(target) {
      if (target.blob) return Img.hashFromBlob(target.blob).then(function (r) { take(target, r); });
      return Store.getBlob(target.localKey || target.url).then(function (cached) {
        if (cached) {
          target.blob = cached;
          return Img.hashFromBlob(cached).then(function (r) { take(target, r); });
        }
        return Img.hashFromUrl(target.url).then(function (r) { take(target, r); });
      });
    }
    cmp.olds.forEach(function (o) {
      if (o.hash || o.status !== 'ok') return;
      jobs.push(function () { return hashOf(o); });
    });
    cmp.news.forEach(function (n) {
      if (n.hash || n.status !== 'ok') return;
      jobs.push(function () { return hashOf(n); });
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
    scheduleSave();
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
      el('span', { class: 'capurl', title: srcLabel(o), text: srcLabel(o) })
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
    var mapping = [];
    if (state.cmp) {
      state.items.forEach(function (i) { i.newUrl = ''; });
      state.cmp.rows.forEach(function (row, i) {
        var o = state.cmp.olds[i];
        var nu = newUrlOf(row);
        if (!nu) return;
        o.newUrl = nu;
        mapping.push({
          no: U.pad(o.index, 3),
          old: srcLabel(o),
          neu: nu,
          conf: Match.LABEL[row.manual ? 'manual' : (row.conf || 'low')] || '-',
          why: row.manual ? '手动指定' : (row.why || []).join(' · ')
        });
      });
    } else {
      // 没走对照也能导出：直接传本机图片的时候，对应关系本来就是确定的
      state.items.filter(function (i) { return i.newUrl; }).forEach(function (o) {
        mapping.push({
          no: U.pad(o.index, 3), old: srcLabel(o), neu: o.newUrl,
          conf: Match.LABEL.high, why: '本工具直接上传'
        });
      });
    }
    if (!mapping.length) { U.toast('还没有配好任何一对，也还没上传过'); return; }

    var totalCount = 0;
    state.outs = state.files.map(function (f, i) {
      var r = Extractor.replaceAll(f.text, state.items, i);
      totalCount += r.count;
      return { name: f.name, text: r.text, count: r.count };
    }).filter(function (o) { return o.text.trim(); });
    state.curOut = 0;
    state.mapping = mapping;

    $('#export-empty').hidden = true;
    $('#export-main').hidden = !state.outs.length;
    $('#table-main').hidden = false;
    $('#links-main').hidden = false;
    renderLinks();
    renderOutTabs();
    $('#replace-info').textContent = '替换了 ' + totalCount + ' 处，涉及 ' + mapping.length + ' 张图' +
      (state.outs.length > 1 ? '、' + state.outs.length + ' 个文件' : '') + '。' +
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

  function mappingCsv() {
    return '﻿序号,可信度,依据,旧链接,新链接\n' + (state.mapping || []).map(function (m) {
      return [m.no, m.conf, m.why, m.old, m.neu].map(csvCell).join(',');
    }).join('\n');
  }

  function linkText() {
    var fmt = (document.querySelector('input[name=linkfmt]:checked') || {}).value || 'url';
    return (state.mapping || []).map(function (m) {
      var alt = U.stem(U.nameFromUrl(m.old, m.no));
      if (fmt === 'md') return '![' + alt + '](' + m.neu + ')';
      if (fmt === 'html') return '<img src="' + m.neu + '" alt="' + U.escapeHtml(alt) + '">';
      if (fmt === 'bb') return '[img]' + m.neu + '[/img]';
      return m.neu;
    }).join('\n');
  }
  function renderLinks() { $('#links-out').value = linkText(); }
  $$('input[name=linkfmt]').forEach(function (r) {
    r.addEventListener('change', renderLinks);
  });
  $('#btn-copy-links').addEventListener('click', function () { U.copyText($('#links-out').value); });
  $('#btn-dl-links').addEventListener('click', function () {
    U.saveBlob(new Blob([$('#links-out').value], { type: 'text/plain;charset=utf-8' }), '新链接.txt');
  });

  function renderOutTabs() {
    var box = $('#out-tabs');
    box.textContent = '';
    box.hidden = state.outs.length < 2;
    $('#btn-dl-all').hidden = state.outs.length < 2;
    if (state.outs.length > 1) {
      state.outs.forEach(function (o, i) {
        var tab = el('button', { class: 'ftab' + (i === state.curOut ? ' on' : '') }, [
          el('span', { class: 'fname', text: o.name, title: o.name }),
          el('span', { class: 'fn', text: o.count ? '改了 ' + o.count + ' 处' : '没改动' })
        ]);
        tab.addEventListener('click', function () { state.curOut = i; renderOutTabs(); });
        box.appendChild(tab);
      });
    }
    var cur = state.outs[state.curOut];
    $('#out-code').value = cur ? cur.text : '';
  }

  function outName(name) {
    return name.replace(/(\.[^.]+)?$/, function (m) { return '-已替换' + (m || '.txt'); });
  }

  $('#btn-copy-code').addEventListener('click', function () { U.copyText($('#out-code').value); });
  $('#btn-dl-code').addEventListener('click', function () {
    var cur = state.outs[state.curOut];
    if (!cur) return;
    U.saveBlob(new Blob([cur.text], { type: 'text/plain;charset=utf-8' }), outName(cur.name));
  });
  $('#btn-dl-all').addEventListener('click', function () {
    if (!state.outs.length) return;
    var entries = state.outs.map(function (o) { return { name: outName(o.name), data: o.text }; });
    entries.push({ name: '链接对照表.csv', data: mappingCsv() });
    U.saveBlob(Zip.build(entries), '已替换的代码.zip');
    U.toast('打包好了：' + state.outs.length + ' 个文件');
  });

  $('#table-main').addEventListener('click', function (e) {
    var b = e.target.closest('[data-fmt]');
    if (!b || !state.mapping) return;
    var fmt = b.dataset.fmt, text, mime = 'text/plain;charset=utf-8', ext = 'txt';
    if (fmt === 'csv') {
      text = mappingCsv();
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

  /* ============ 进度缓存 ============
     手机浏览器会把后台标签页直接回收，回来等于重新打开。
     所以每有变动就把进度写进本机，下次打开自动接上。 */

  var SAVE_KEY = 'session', SAVE_V = 2;
  var saveTimer = null, restoring = false, wiping = false;

  function snapshot() {
    if (state.files[state.curFile]) state.files[state.curFile].text = $('#src').value;
    return {
      v: SAVE_V,
      time: Date.now(),
      files: state.files,
      curFile: state.curFile,
      baseUrl: $('#base-url').value,
      newUrlsText: $('#new-urls').value,
      panel: (document.querySelector('.panel.active') || {}).id || 'panel-input',
      items: state.items.map(function (i) {
        return {
          id: i.id, url: i.url, raw: i.raw, kind: i.kind, resolved: i.resolved, isData: i.isData,
          isLocal: i.isLocal, localKey: i.localKey,
          occurrences: i.occurrences, index: i.index, filename: i.filename,
          status: i.status, w: i.w, h: i.h, newUrl: i.newUrl, sel: i.sel,
          hash: i.hash, size: i.size, deadReason: i.deadReason
        };
      }),
      cmp: state.cmp ? {
        oldIds: state.cmp.olds.map(function (o) { return o.id; }),
        news: state.cmp.news.map(function (n) {
          return { url: n.url, filename: n.filename, w: n.w, h: n.h, hash: n.hash, status: n.status };
        }),
        rows: state.cmp.rows
      } : null
    };
  }

  function saveNow() {
    // wiping：用户正在清空，别让 pagehide 上的这次保存把刚删掉的又写回去
    if (restoring || wiping) return Promise.resolve();
    var anyText = state.files.some(function (f) { return f.text.trim(); });
    if (!state.items.length && !anyText && !$('#src').value.trim()) return Store.del(SAVE_KEY);
    return Store.set(SAVE_KEY, snapshot());
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  function restoreSession() {
    return Store.get(SAVE_KEY).then(function (d) {
      if (!d || d.v !== SAVE_V) return;
      restoring = true;
      try {
        if (d.files && d.files.length) {
          state.files = d.files;
          state.curFile = Math.min(d.curFile || 0, d.files.length - 1);
          renderFileTabs();
          $('#src').value = state.files[state.curFile].text;
        }
        if (d.baseUrl) $('#base-url').value = d.baseUrl;
        if (d.newUrlsText) $('#new-urls').value = d.newUrlsText;
        updateSrcInfo();

        if (d.items && d.items.length) {
          state.items = d.items.map(function (i) { i.blob = null; return i; });
          // 本机文件的 blob: 地址刷新就失效了，从缓存里把文件捞回来重新生成
          var locals = state.items.filter(function (i) { return i.isLocal; });
          if (locals.length) {
            Promise.all(locals.map(function (i) {
              return Store.getBlob(i.localKey).then(function (b) {
                if (b) { i.blob = b; i.url = URL.createObjectURL(b); }
                else { i.status = 'dead'; i.deadReason = '本机文件的缓存没了'; }
              });
            })).then(function () { renderGrid(); });
          }
          $('#tab-count').textContent = state.items.length;
          $('#images-empty').hidden = true;
          $('#images-main').hidden = false;
          renderGrid();
          $('#btn-load-uploaded').disabled = !state.items.some(function (i) { return i.newUrl; });

          if (d.cmp && d.cmp.rows) {
            var byId = {};
            state.items.forEach(function (i) { byId[i.id] = i; });
            var olds = d.cmp.oldIds.map(function (id) { return byId[id]; });
            // 有对不上的就整块跳过，宁可让用户重新匹配，也不要错位
            if (olds.every(Boolean) && olds.length === d.cmp.rows.length) {
              state.cmp = { olds: olds, news: d.cmp.news, rows: d.cmp.rows };
              renderCompare(false);
            }
          }
          showRestoreBar(d);
          if (d.panel && document.getElementById(d.panel)) switchTab(d.panel);
        }
      } finally {
        restoring = false;
      }
    })['catch'](function () { restoring = false; });
  }

  function ago(t) {
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    if (s < 86400) return Math.round(s / 3600) + ' 小时前';
    return Math.round(s / 86400) + ' 天前';
  }

  function showRestoreBar(d) {
    var done = (d.cmp && d.cmp.rows) ? d.cmp.rows.filter(function (r) { return r.ni >= 0 || r.manual; }).length : 0;
    $('#restore-text').textContent =
      '接着上次继续：' + d.items.length + ' 张图' +
      (done ? '、已配好 ' + done + ' 对' : '') + '（' + ago(d.time) + '存的）';
    $('#restore-bar').hidden = false;
  }

  $('#btn-restart').addEventListener('click', function () {
    wiping = true;
    clearTimeout(saveTimer);
    Store.del(SAVE_KEY).then(function () { location.reload(); });
  });

  $('#btn-clear-cache').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    wiping = true;
    clearTimeout(saveTimer);
    Store.clearAll().then(function () {
      U.toast('缓存清完了，页面马上刷新');
      setTimeout(function () { location.reload(); }, 700);
    });
  });

  function refreshCacheInfo() {
    Promise.all([Store.blobCount(), Store.usage()]).then(function (r) {
      var n = r[0], u = r[1];
      var parts = [];
      if (n) parts.push('已缓存 ' + n + ' 张图片');
      if (u && u.used) parts.push('本机占用约 ' + U.fmtBytes(u.used) +
        (u.quota ? '，这个浏览器大约能放 ' + U.fmtBytes(u.quota) : ''));
      var txt = parts.join('，');
      $('#cache-info').textContent = n ? txt : '';
      $('#cache-info2').textContent = txt || '目前还没存什么';
    });
  }

  /* 页面被切走 / 关掉之前赶紧存一次 */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', saveNow);

  $('#base-url').addEventListener('change', scheduleSave);
  $('#new-urls').addEventListener('input', scheduleSave);

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
  initSaveBar();
  restoreSession().then(refreshCacheInfo);
  loadRelay();
  initHostSelect();
  updateSrcInfo();
  $('#btn-load-uploaded').disabled = true;
})();
