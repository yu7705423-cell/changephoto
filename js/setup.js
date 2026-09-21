/* 搭建图床向导：从注册账号到拿到 token，一步步带着做。
   填好的配置直接写进「转存到图床」用的同一份存储，搭完就能开始搬。 */
(function (global) {
  'use strict';

  var $ = U.$, el = U.el;

  function link(href, text) {
    return el('a', { class: 'ext', href: href, target: '_blank', rel: 'noopener noreferrer', text: text });
  }
  function note(text, warn) {
    return el('div', { class: 'note' + (warn ? ' warn' : ''), html: text });
  }
  function para(html) { return el('p', { html: html }); }

  /* fetch 在网络不通 / 被拦截 / 证书有问题时一律抛 TypeError('Failed to fetch')，
     原样显示没人看得懂，这里翻译成能照着排查的说法 */
  function netErr(e, who) {
    if (e instanceof TypeError) {
      return new Error('连不上 ' + who + '：可能是网络不通、被防火墙拦了，或者浏览器插件挡了请求。' +
                       '换个网络环境或关掉代理再试试');
    }
    return e;
  }

  var SETUP = {

    github: {
      name: 'GitHub + jsDelivr',
      desc: '免费，不用绑卡。把图片当文件提交进一个公开仓库，再用 jsDelivr 做 CDN 加速',
      tag: '国内访问可能不稳定',
      lead: '最适合长期放不怕被人看到的图：仓库是你自己的，服务方跑路了图还在。',
      steps: [
        {
          title: '注册 / 登录 GitHub',
          body: function () {
            return [
              para('没有账号就先注册一个。你的用户名就是主页地址里 <code>github.com/</code> 后面那一段。'),
              el('div', { class: 'link-row' }, [link('https://github.com/join', '去注册'), link('https://github.com/login', '去登录')])
            ];
          },
          fields: [{ key: 'owner', label: 'GitHub 用户名', placeholder: '例如 octocat' }]
        },
        {
          title: '新建一个公开仓库',
          body: function () {
            return [
              para('创建时勾上 “Add a README file”，可见性<b>一定要选 Public</b> —— 私有仓库 jsDelivr 读不到。分支名不确定就填 <code>main</code>。'),
              el('div', { class: 'link-row' }, [link('https://github.com/new', '去新建仓库')])
            ];
          },
          fields: [
            { key: 'repo', label: '仓库名', placeholder: '例如 image-host' },
            { key: 'branch', label: '分支名', placeholder: 'main', value: 'main' },
            { key: 'dir', label: '存放目录', placeholder: 'images', value: 'images' }
          ]
        },
        {
          title: '生成 Personal Access Token',
          body: function () {
            return [
              para('用来让这个工具替你把图片提交进仓库。'),
              el('div', { class: 'link-row' }, [link('https://github.com/settings/tokens/new', '去生成 Token（classic）')]),
              note('权限范围只勾 <b>repo</b> 这一项就够。有效期可以选 “No expiration”。<b>生成后立刻复制粘贴到下面</b> —— 这串 Token 只完整显示一次，关掉页面就再也看不到了。')
            ];
          },
          fields: [{ key: 'token', label: 'Personal Access Token', placeholder: 'ghp_ 或 github_pat_ 开头的一长串', type: 'password' }]
        }
      ],
      warn: 'jsDelivr 在国内经常被 DNS 污染，图片可能间歇性加载失败。如果你的读者主要在国内，' +
            '可以在转存时把「生成链接」改成 Statically 或 raw 试试，或者把它当备用图床。',
      test: function (cfg) {
        if (!cfg.owner || !cfg.repo) throw new Error('用户名和仓库名都要填');
        if (!cfg.token) throw new Error('还没填 Token');
        return fetch('https://api.github.com/repos/' + cfg.owner.trim() + '/' + cfg.repo.trim(), {
          headers: { Authorization: 'Bearer ' + cfg.token.trim(), Accept: 'application/vnd.github+json' }
        }).then(function (r) {
          if (r.ok) {
            return r.json().then(function (d) {
              if (d['private']) return '连上了，但这个仓库是私有的 —— jsDelivr 读不到，去仓库 Settings 改成 Public';
              return '连上了，仓库是公开的，可以用 ✓';
            });
          }
          if (r.status === 404) throw new Error('找不到这个仓库：用户名或仓库名填错了，或者 Token 没有访问它的权限');
          if (r.status === 401) throw new Error('Token 无效或已过期');
          if (r.status === 403) throw new Error('Token 权限不够，重新生成一个勾上 repo 的');
          throw new Error('连接失败（HTTP ' + r.status + '）');
        }).catch(function (e) { throw netErr(e, 'GitHub'); });
      }
    },

    imgbb: {
      name: 'ImgBB',
      desc: '免费图床，注册就能用，浏览器直传，不用部署任何东西',
      tag: '最省事',
      lead: '想赶紧搬完不折腾的话选这个。缺点是官方没有标准删除接口，传上去就不好删了。',
      steps: [
        {
          title: '注册 / 登录 ImgBB',
          body: function () {
            return [el('div', { class: 'link-row' }, [link('https://imgbb.com/signup', '去注册'), link('https://imgbb.com/login', '去登录')])];
          }
        },
        {
          title: '获取 API Key',
          body: function () {
            return [
              para('登录后打开 API 页面，点 “Get API key”，把那串 key 复制过来。'),
              el('div', { class: 'link-row' }, [link('https://api.imgbb.com/', '去获取 API Key')])
            ];
          },
          fields: [{ key: 'key', label: 'API Key', placeholder: '复制粘贴过来', type: 'password' }]
        }
      ],
      warn: 'ImgBB 没有提供标准的删除接口。转存成功后工具会把「删除链接」记在上传日志里，' +
            '要删得自己打开那个链接手动确认。',
      test: function (cfg) {
        if (!cfg.key) throw new Error('还没填 API Key');
        // ImgBB 没有单独的校验接口，传一张 1×1 的透明图试试
        var px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
        var fd = new FormData();
        fd.append('image', px);
        return fetch('https://api.imgbb.com/1/upload?expiration=60&key=' + encodeURIComponent(cfg.key.trim()), {
          method: 'POST', body: fd
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.success) return '连上了，Key 有效 ✓（刚才传了一张 1×1 的测试图，60 秒后自动删）';
          throw new Error((d && d.error && d.error.message) || 'API Key 无效');
        }).catch(function (e) { throw netErr(e, 'ImgBB'); });
      }
    },

    smms: {
      name: 'S.EE（原 SM.MS）',
      desc: 'SM.MS 已整体迁到 s.ee，同一团队运营，接口仍兼容原来的 v2 API',
      tag: '新用户不再免费',
      lead: '老牌图床，浏览器直传。但这次换域名本身就说明服务形态会变，别把不能丢的图放这。',
      steps: [
        {
          title: '注册 / 登录 S.EE',
          body: function () {
            return [
              para('老用户直接登录；新用户注册后需要开通付费套餐才能传图。'),
              el('div', { class: 'link-row' }, [link('https://s.ee/register', '去注册'), link('https://s.ee/login', '去登录')]),
              note('<b>迁移须知</b>：原 sm.ms 的账号和图片已迁到 s.ee，但出于安全考虑<b>密码没有一起迁移</b>，' +
                   '老用户要用原邮箱走一次「忘记密码」重设。另外 s.ee <b>不再开放免费注册</b>，' +
                   '2026 年 2 月前注册的免费账号可以继续用；新用户想用得买套餐，否则建议改选 GitHub 或 ImgBB。', true)
            ];
          }
        },
        {
          title: '获取 API Token',
          body: function () {
            return [
              para('登录后进控制台的 API Token 页面，复制上面显示的 Token。原 sm.ms 的旧 Token 迁移后可能已失效，建议重新生成一个。'),
              el('div', { class: 'link-row' }, [
                link('https://s.ee/user/dashboard/', '去获取 Token'),
                link('https://s.ee/docs/developers/smms-compatibility/', 'SM.MS 兼容说明')
              ])
            ];
          },
          fields: [
            { key: 'token', label: 'API Token', placeholder: '复制粘贴过来', type: 'password' },
            { key: 'base', label: '接口域名', type: 'select', value: 'https://s.ee',
              options: [{ value: 'https://s.ee', label: 's.ee（新域名，推荐）' },
                        { value: 'https://sm.ms', label: 'sm.ms（旧域名）' }] }
          ]
        }
      ],
      warn: '这类公共图床历史上出现过限流和图片被清理的情况。另外如果你之前把 sm.ms 的外链写在文章里，' +
            '那些旧链接可能也需要换成 s.ee 域名 —— 正好可以用这个工具批量换。',
      test: function (cfg) {
        if (!cfg.token) throw new Error('还没填 API Token');
        var base = cfg.base || 'https://s.ee';
        return fetch(base + '/api/v2/profile', {
          method: 'POST', headers: { Authorization: cfg.token.trim() }
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.success) {
            var u = d.data || {};
            return '连上了 ✓' + (u.username ? '（账号 ' + u.username + '）' : '');
          }
          throw new Error((d && d.message) || 'Token 无效');
        }).catch(function (e) {
          if (e instanceof TypeError) {
            throw new Error('请求没发出去 —— 多半是浏览器跨域被拦了（转存时勾上「通过 Worker 中转上传」就能绕过去），' +
                            '也可能是网络不通或该域名打不开');
          }
          throw e;
        });
      }
    },

    r2: {
      name: 'Cloudflare R2',
      desc: '10GB 免费空间、出口流量全免费、速度稳，但要绑支付方式并部署一个 Worker',
      tag: '需要绑卡',
      lead: '四个里最耐用的方案。要多花十分钟，但之后就不用再操心图床跑路了。' +
            '本工具的 Worker 一份代码同时干两件事：给 R2 收图，以及中转抓取旧图床的图（绕开跨域和防盗链）。',
      steps: [
        {
          title: '注册 Cloudflare 并启用 R2',
          body: function () {
            return [
              para('注册后进控制台左侧的 R2 Object Storage，按提示绑定支付方式激活。'),
              el('div', { class: 'link-row' }, [
                link('https://dash.cloudflare.com/sign-up', '去注册 Cloudflare'),
                link('https://dash.cloudflare.com/?to=/:account/r2', '去启用 R2')
              ]),
              note('<b>启用 R2 必须绑信用卡或 PayPal</b>，用于身份验证。免费额度内（10GB 存储、每月 100 万次写、' +
                   '1000 万次读）不扣费，超出才按量计费，不是自动订阅扣款。不放心可以用虚拟卡。' +
                   '实在不想绑卡就回上面选 GitHub 或 ImgBB。', true)
            ];
          }
        },
        {
          title: '创建一个 Bucket 并开公开访问',
          body: function () {
            return [
              para('名字随意，比如 <code>image-host</code>。建好后进 Bucket 的 Settings → Public access 打开，' +
                   '会给你一个形如 <code>https://pub-xxxx.r2.dev</code> 的公开域名，粘到下面。' +
                   '有自己的域名也可以绑自定义域，速度更好。')
            ];
          },
          fields: [
            { key: 'publicBase', label: '图片公开访问域名', placeholder: 'https://pub-xxxx.r2.dev' },
            { key: 'dir', label: '存放目录', placeholder: 'images', value: 'images' }
          ]
        },
        {
          title: '部署 Worker',
          body: function () {
            var box = el('div');
            box.appendChild(para('控制台左侧 <b>Workers & Pages → Create → Start with Hello World! → Deploy</b>，' +
              '部署完点 <b>Edit code</b>，把默认代码整个替换成本工具的 Worker 代码，再点 Deploy。'));
            var wrap = el('div', { class: 'code-wrap' });
            var pre = el('pre', { class: 'codeblock', text: '点右边的按钮载入 worker/image-proxy.js 的内容…' });
            var btn = el('button', {
              class: 'btn tiny code-copy', text: '载入代码',
              onclick: function () { loadWorkerCode(pre, btn); }
            });
            wrap.appendChild(pre); wrap.appendChild(btn);
            box.appendChild(wrap);
            box.appendChild(note('部署好之后，在这个 Worker 的 <b>Settings → Variables and Secrets</b> 里加两项：<br>' +
              '· <code>ACCESS_TOKEN</code> ＝ 你自己编一串密码（<b>一定要设</b>，不然别人拿到地址就能白嫖你的流量）<br>' +
              '· 绑定 R2：<b>Settings → Bindings → Add → R2 bucket</b>，变量名<b>必须填 <code>BUCKET</code></b>，选上一步建的桶<br>' +
              '· 再加一个变量 <code>PUBLIC_BASE</code> ＝ 上一步那个公开域名'));
            return [box];
          },
          fields: [
            { key: '_relayUrl', label: 'Worker 地址', placeholder: 'https://xxx.workers.dev' },
            { key: '_relayToken', label: '你设的 ACCESS_TOKEN', placeholder: '和 Worker 变量里一致', type: 'password' }
          ]
        }
      ],
      warn: '这个 Worker 同时也是「输入」页里的中转地址 —— 填在这里就等于配好了中转，' +
            '抓取旧图床里跨域或防盗链的图也会一起变得能取到。',
      test: function (cfg) {
        var url = (cfg._relayUrl || '').trim().replace(/\/+$/, '');
        if (!url) throw new Error('还没填 Worker 地址');
        return fetch(url + '/ping' + (cfg._relayToken ? '?key=' + encodeURIComponent(cfg._relayToken.trim()) : ''))
          .then(function (r) {
            if (r.status === 401) throw new Error('口令不对，检查 ACCESS_TOKEN 是否和 Worker 里一致');
            if (!r.ok) throw new Error('Worker 返回 HTTP ' + r.status);
            return r.json();
          })
          .then(function (d) {
            if (!d.r2) throw new Error('Worker 通了，但还没绑定 R2 存储桶 —— 变量名要叫 BUCKET');
            if (!d.publicBase && !cfg.publicBase) {
              return 'Worker 和 R2 都通了 ✓ 不过公开域名还没设，记得填上一步那个 PUBLIC_BASE';
            }
            return 'Worker 通了，R2 已绑定 ✓ 可以开始传了';
          })
          .catch(function (e) {
            if (e instanceof TypeError) throw new Error('连不上，检查地址是否正确、Worker 是否已部署');
            throw e;
          });
      }
    }
  };

  function loadWorkerCode(pre, btn) {
    btn.disabled = true;
    btn.textContent = '载入中…';
    fetch('worker/image-proxy.js', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (code) {
        pre.textContent = code;
        btn.disabled = false;
        btn.textContent = '复制代码';
        btn.onclick = function () { U.copyText(code); };
      })
      .catch(function () {
        // 本地直接双击打开页面时 fetch 会被拦，那就让浏览器直接打开这个文件
        pre.textContent = '这里读不到文件（多半是本地双击打开的，浏览器不让读同目录文件）。\n' +
                          '点右边按钮会直接打开 worker/image-proxy.js，全选复制即可。';
        btn.disabled = false;
        btn.textContent = '打开代码文件';
        btn.onclick = function () { window.open('worker/image-proxy.js', '_blank', 'noopener'); };
      });
  }

  /* ---------------- 界面 ---------------- */

  var current = null;

  function cfgOf(id) { return U.store.get('cfg:' + id, {}); }
  function saveCfg(id, cfg) { U.store.set('cfg:' + id, cfg); }
  function isDone(id) { return !!U.store.get('done:' + id, false); }

  function renderProviders() {
    var box = $('#providers');
    box.textContent = '';
    Object.keys(SETUP).forEach(function (id) {
      var p = SETUP[id];
      var card = el('button', { class: 'provider' + (current === id ? ' on' : ''), 'data-id': id }, [
        el('span', { class: 'pname' }, [
          document.createTextNode(p.name),
          el('span', { class: 'pdone', text: isDone(id) ? '✓ 已搭好' : '' })
        ]),
        el('span', { class: 'pdesc', text: p.desc }),
        el('span', { class: 'ptag', text: p.tag })
      ]);
      card.addEventListener('click', function () { open(id); });
      box.appendChild(card);
    });
  }

  function fieldEl(id, f) {
    var cfg = cfgOf(id);
    var val = cfg[f.key] !== undefined ? cfg[f.key] : (f.value !== undefined ? f.value : '');
    var input;
    if (f.type === 'select') {
      input = el('select');
      f.options.forEach(function (o) { input.appendChild(el('option', { value: o.value, text: o.label })); });
      input.value = val;
    } else {
      input = el('input', { type: f.type || 'text', placeholder: f.placeholder || '', value: val });
    }
    input.addEventListener('change', function () {
      var c = cfgOf(id);
      c[f.key] = input.value.trim();
      saveCfg(id, c);
      if (id === 'r2') syncRelay(c);
    });
    return el('div', { class: 'field' }, [el('label', { text: f.label }), input]);
  }

  /* R2 的 Worker 地址就是全局中转地址，两边保持一致 */
  function syncRelay(cfg) {
    var url = (cfg._relayUrl || '').trim(), token = (cfg._relayToken || '').trim();
    if (!url) return;
    U.store.set('relay', { url: url, token: token });
    var ui = $('#relay-url'), ut = $('#relay-token');
    if (ui) { ui.value = url; ut.value = token; }
    Img.setRelay(url, token);
  }

  function open(id) {
    current = id;
    renderProviders();
    var p = SETUP[id];
    var box = $('#wizard');
    box.textContent = '';
    $('#wizard-box').hidden = false;

    box.appendChild(el('h1', { text: p.name }));
    box.appendChild(el('p', { class: 'lead', text: p.lead }));

    p.steps.forEach(function (st, i) {
      var body = el('div', { class: 'step-body' });
      body.appendChild(el('h4', { text: st.title }));
      st.body().forEach(function (n) { body.appendChild(n); });
      if (st.fields) {
        var row = el('div', { class: 'field-row' });
        st.fields.forEach(function (f) { row.appendChild(fieldEl(id, f)); });
        body.appendChild(row);
      }
      box.appendChild(el('div', { class: 'step' }, [
        el('div', { class: 'step-n', text: String(i + 1) }), body
      ]));
    });

    /* 最后一步：测试连接 */
    var status = el('span', { class: 'setup-status hint', text: '' });
    var testBtn = el('button', {
      class: 'btn primary', text: '测试连接并保存',
      onclick: function () { runTest(id, testBtn, status); }
    });
    var useBtn = el('button', {
      class: 'btn', text: '用这个图床去转存 →', hidden: isDone(id) ? null : 'hidden',
      onclick: function () { useHost(id); }
    });
    var body = el('div', { class: 'step-body' }, [
      el('h4', { text: '测试连接' }),
      el('p', { text: '上面填完之后点一下，确认配置没问题。通过了就会自动填进「转存到图床」。' }),
      el('div', { class: 'row-flex' }, [testBtn, useBtn, status])
    ]);
    box.appendChild(el('div', { class: 'step' }, [
      el('div', { class: 'step-n', text: String(p.steps.length + 1) }), body
    ]));

    if (p.warn) box.appendChild(note(p.warn, true));
    $('#wizard-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function runTest(id, btn, status) {
    var cfg = cfgOf(id);
    btn.disabled = true;
    status.textContent = '测试中…';
    Promise.resolve()
      .then(function () { return SETUP[id].test(cfg); })
      .then(function (msg) {
        U.store.set('done:' + id, true);
        if (id === 'r2') syncRelay(cfg);
        status.textContent = '✓ ' + msg;
        U.toast('搭好了！配置已经填进「转存到图床」owo');
        renderProviders();
        var useBtn = btn.parentNode.querySelector('.btn:not(.primary)');
        if (useBtn) useBtn.hidden = false;
      })
      .catch(function (e) {
        U.store.set('done:' + id, false);
        status.textContent = '✕ ' + (e.message || e);
        renderProviders();
      })
      .then(function () { btn.disabled = false; });
  }

  /* 切到「图片」页并把图床选成这个 */
  function useHost(id) {
    var sel = $('#host');
    if (sel) {
      sel.value = id;
      sel.dispatchEvent(new Event('change'));
    }
    var chk = $('#remember-token');
    if (chk && !chk.checked) { chk.checked = true; U.store.set('remember', true); }
    var tab = document.querySelector('.tab[data-panel="panel-images"]');
    if (tab) tab.click();
    var up = $('#upload-box');
    if (up) {
      up.hidden = false;
      up.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  renderProviders();
  global.Setup = { open: open, SETUP: SETUP };
})(window);
