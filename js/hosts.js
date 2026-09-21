/* 图床适配器。每个适配器只要实现 upload(blob, filename, cfg) -> { url, deleteUrl } */
(function (global) {
  'use strict';

  /* 通过自己部署的 Worker 转发请求，用来绕开图床 API 的跨域限制 */
  function forward(target, init, headerAuth) {
    var r = Img.relayInfo();
    if (!r.url) throw new Error('这个选项需要先在「输入」里填 Worker 中转地址');
    var u = r.url + '/forward' + (r.token ? '?key=' + encodeURIComponent(r.token) : '');
    var headers = Object.assign({}, init.headers || {});
    headers['X-Target-Url'] = target;
    if (headerAuth) {
      headers['X-Forward-Authorization'] = headerAuth;
      delete headers.Authorization;
    }
    return fetch(u, Object.assign({}, init, { headers: headers }));
  }

  function doPost(target, init, cfg, headerAuth) {
    if (cfg && cfg.viaRelay) return forward(target, init, headerAuth);
    var h = Object.assign({}, init.headers || {});
    if (headerAuth) h.Authorization = headerAuth;
    return fetch(target, Object.assign({}, init, { headers: h }));
  }

  function asJson(r) {
    return r.text().then(function (t) {
      var j = null;
      try { j = JSON.parse(t); } catch (e) {}
      return { status: r.status, ok: r.ok, json: j, text: t };
    });
  }

  function dig(obj, path) {
    if (!obj || !path) return undefined;
    return path.split('.').reduce(function (o, k) {
      if (o === undefined || o === null) return undefined;
      var m = /^(\w+)\[(\d+)\]$/.exec(k);
      if (m) return (o[m[1]] || [])[+m[2]];
      return o[k];
    }, obj);
  }

  function fail(res, fallback) {
    var msg = (res.json && (res.json.error && (res.json.error.message || res.json.error))) ||
              (res.json && (res.json.message || res.json.msg)) ||
              (res.text || '').slice(0, 160) || fallback;
    return new Error('HTTP ' + res.status + '：' + msg);
  }

  var HOSTS = {

    /* ---------------- GitHub 仓库 + jsDelivr CDN ---------------- */
    github: {
      name: 'GitHub + jsDelivr',
      note: '把图片提交到你的公开仓库，再用 jsDelivr 免费加速。仓库必须是 public，jsDelivr 才读得到。' +
            ' Token 在 GitHub → Settings → Developer settings → Personal access tokens 生成，勾 repo（细粒度 token 给 Contents 读写权限即可）。',
      fields: [
        { key: 'token', label: 'GitHub Token', type: 'password', required: true, placeholder: 'ghp_… 或 github_pat_…' },
        { key: 'repo', label: '仓库', type: 'text', required: true, placeholder: '用户名/仓库名' },
        { key: 'branch', label: '分支', type: 'text', value: 'main', placeholder: 'main' },
        { key: 'dir', label: '存放目录', type: 'text', value: 'images', placeholder: 'images 或 images/2026' },
        { key: 'linkStyle', label: '生成链接', type: 'select', value: 'jsdelivr',
          options: [
            { value: 'jsdelivr', label: 'jsDelivr CDN（推荐，快）' },
            { value: 'raw', label: 'raw.githubusercontent.com' },
            { value: 'statically', label: 'Statically CDN' }
          ] }
      ],
      upload: function (blob, filename, cfg) {
        var repo = String(cfg.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/^\/|\/$/g, '');
        if (repo.split('/').length !== 2) throw new Error('仓库要写成「用户名/仓库名」');
        var branch = (cfg.branch || 'main').trim();
        var dir = String(cfg.dir || '').trim().replace(/^\/|\/$/g, '');

        return U.blobToBase64(blob).then(function (b64) {
          var attempt = 0;
          function put(name) {
            var path = (dir ? dir + '/' : '') + name;
            var api = 'https://api.github.com/repos/' + repo + '/contents/' +
                      path.split('/').map(encodeURIComponent).join('/');
            return fetch(api, {
              method: 'PUT',
              headers: {
                'Authorization': 'Bearer ' + String(cfg.token).trim(),
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                message: 'upload ' + name,
                content: b64,
                branch: branch
              })
            }).then(asJson).then(function (res) {
              if (res.ok) return { url: buildUrl(repo, branch, path, cfg.linkStyle), path: path };
              // 同名文件已存在 —— 换个名字再传一次，不覆盖别人的东西
              var exists = res.status === 422 || res.status === 409 ||
                           /sha|already exists/i.test(res.text || '');
              if (exists && attempt < 2) {
                attempt++;
                var stem = U.stem(name), ext = name.slice(stem.length);
                return put(stem + '-' + Math.random().toString(36).slice(2, 7) + ext);
              }
              if (res.status === 401 || res.status === 403) {
                throw new Error('Token 没通过（' + res.status + '）：检查权限和仓库名');
              }
              throw fail(res, '上传失败');
            });
          }
          return put(filename);
        });

        function buildUrl(repo, branch, path, style) {
          var p = path.split('/').map(encodeURIComponent).join('/');
          if (style === 'raw') return 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + p;
          if (style === 'statically') return 'https://cdn.statically.io/gh/' + repo + '/' + branch + '/' + p;
          return 'https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + p;
        }
      }
    },

    /* ---------------- ImgBB ---------------- */
    imgbb: {
      name: 'ImgBB',
      note: 'API Key 在 imgbb.com → 登录后打开 api.imgbb.com 点 Get API key。单张最大 32MB。',
      fields: [
        { key: 'key', label: 'API Key', type: 'password', required: true, placeholder: 'imgbb 的 api key' },
        { key: 'expiration', label: '自动删除', type: 'select', value: '',
          options: [
            { value: '', label: '永久保存' },
            { value: '2592000', label: '30 天后删除' },
            { value: '604800', label: '7 天后删除' }
          ] }
      ],
      upload: function (blob, filename, cfg) {
        return U.blobToBase64(blob).then(function (b64) {
          var fd = new FormData();
          fd.append('key', String(cfg.key).trim());
          fd.append('image', b64);
          fd.append('name', U.stem(filename));
          var url = 'https://api.imgbb.com/1/upload' +
                    (cfg.expiration ? '?expiration=' + cfg.expiration : '');
          return doPost(url, { method: 'POST', body: fd }, cfg).then(asJson).then(function (res) {
            var link = dig(res.json, 'data.url') || dig(res.json, 'data.display_url');
            if (res.ok && link) {
              return { url: link, deleteUrl: dig(res.json, 'data.delete_url') };
            }
            throw fail(res, '上传失败');
          });
        });
      }
    },

    /* ---------------- SM.MS ---------------- */
    smms: {
      name: 'SM.MS',
      note: 'Token 在 sm.ms → 登录后 User → API Token 生成。单张最大 5MB，每分钟限 20 张，' +
            '所以这里会自动放慢速度。如果浏览器报跨域错误，勾上「通过 Worker 中转」。',
      fields: [
        { key: 'token', label: 'API Token', type: 'password', required: true, placeholder: 'sm.ms 的 API Token' },
        { key: 'viaRelay', label: '通过 Worker 中转上传（跨域失败时勾这个）', type: 'checkbox' }
      ],
      throttle: 3200,
      upload: function (blob, filename, cfg) {
        if (blob.size > 5 * 1024 * 1024) throw new Error('SM.MS 单张上限 5MB，这张 ' + U.fmtBytes(blob.size));
        var fd = new FormData();
        fd.append('smfile', blob, filename);
        fd.append('format', 'json');
        return doPost('https://sm.ms/api/v2/upload', { method: 'POST', body: fd }, cfg,
                      String(cfg.token).trim())
          .then(asJson).then(function (res) {
            var j = res.json;
            if (j && j.success && dig(j, 'data.url')) {
              return { url: j.data.url, deleteUrl: dig(j, 'data.delete') };
            }
            // 同一张图之前传过，SM.MS 会直接把老链接还回来
            if (j && j.code === 'image_repeated' && j.images) {
              return { url: j.images, note: '这张图之前传过，复用了原链接' };
            }
            throw fail(res, (j && j.message) || '上传失败');
          });
      }
    },

    /* ---------------- Cloudflare R2（经自己的 Worker） ---------------- */
    r2: {
      name: 'Cloudflare R2（经 Worker）',
      needsRelay: true,
      note: 'R2 不能从浏览器直传，要走你自己部署的 Worker。在「输入」里填好中转地址，' +
            '并按 worker/README.md 绑定 R2 存储桶（变量名 BUCKET）、设好 PUBLIC_BASE 公开域名。',
      fields: [
        { key: 'dir', label: '存放目录', type: 'text', value: 'images', placeholder: 'images 或 blog/2026' },
        { key: 'publicBase', label: '公开访问域名', type: 'text', placeholder: '留空则用 Worker 里配的 PUBLIC_BASE' }
      ],
      upload: function (blob, filename, cfg) {
        var r = Img.relayInfo();
        if (!r.url) throw new Error('请先在「输入」里填 Worker 中转地址');
        var dir = String(cfg.dir || '').trim().replace(/^\/|\/$/g, '');
        var key = (dir ? dir + '/' : '') + filename;
        var u = r.url + '/upload?key_name=' + encodeURIComponent(key) +
                (r.token ? '&key=' + encodeURIComponent(r.token) : '') +
                (cfg.publicBase ? '&base=' + encodeURIComponent(String(cfg.publicBase).trim()) : '');
        return fetch(u, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'application/octet-stream' },
          body: blob
        }).then(asJson).then(function (res) {
          if (res.ok && res.json && res.json.url) return { url: res.json.url };
          throw fail(res, '上传失败（检查 Worker 是否绑定了 R2）');
        });
      }
    },

    /* ---------------- 通用自定义接口（兰空 / Chevereto / 自建都能接） ---------------- */
    custom: {
      name: '自定义接口（兰空图床 / Chevereto / 自建）',
      note: '按你的图床文档填。举例：兰空图床 V2 —— 接口 https://你的域名/api/v1/upload，' +
            '字段名 file，Authorization 填 Bearer xxx，链接字段 data.links.url。',
      fields: [
        { key: 'endpoint', label: '接口地址', type: 'text', required: true, placeholder: 'https://your-host/api/v1/upload' },
        { key: 'field', label: '文件表单字段名', type: 'text', value: 'file', placeholder: 'file' },
        { key: 'auth', label: 'Authorization 头', type: 'password', placeholder: 'Bearer xxxxxx（没有就留空）' },
        { key: 'jsonPath', label: '返回里链接的字段路径', type: 'text', value: 'data.links.url', placeholder: 'data.links.url' },
        { key: 'viaRelay', label: '通过 Worker 中转上传（跨域失败时勾这个）', type: 'checkbox' }
      ],
      upload: function (blob, filename, cfg) {
        var fd = new FormData();
        fd.append(String(cfg.field || 'file'), blob, filename);
        return doPost(String(cfg.endpoint).trim(), {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: fd
        }, cfg, cfg.auth ? String(cfg.auth).trim() : '')
          .then(asJson).then(function (res) {
            var link = dig(res.json, String(cfg.jsonPath || 'data.links.url'));
            if (typeof link === 'string' && link) return { url: link };
            if (res.ok) {
              throw new Error('上传好像成功了，但按「' + cfg.jsonPath + '」取不到链接。返回内容：' +
                              (res.text || '').slice(0, 200));
            }
            throw fail(res, '上传失败');
          });
      }
    }
  };

  global.Hosts = HOSTS;
})(window);
