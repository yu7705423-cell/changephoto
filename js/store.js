/* 本地缓存：进度存起来，图片二进制也存起来。
   手机浏览器会把后台标签页直接回收掉，回来等于重新打开 —— 有这层就不会白忙一场。
   用 IndexedDB（能直接存 Blob、容量也大）；用不了就退回 localStorage 只存进度。 */
(function (global) {
  'use strict';

  var DB_NAME = 'image-mover', KV = 'kv', BLOBS = 'blobs';
  var dbPromise = null, idbBroken = false;

  function idb() {
    if (idbBroken) return Promise.reject(new Error('indexedDB 不可用'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try { req = global.indexedDB.open(DB_NAME, 1); }
      catch (e) { idbBroken = true; return reject(e); }
      if (!req) { idbBroken = true; return reject(new Error('打不开数据库')); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { idbBroken = true; reject(req.error); };
      req.onblocked = function () { idbBroken = true; reject(new Error('数据库被占用')); };
    });
    return dbPromise['catch'](function (e) { idbBroken = true; throw e; });
  }

  function tx(store, mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t, s, req;
        try {
          t = db.transaction(store, mode);
          s = t.objectStore(store);
          req = fn(s);
        } catch (e) { return reject(e); }
        t.oncomplete = function () { resolve(req ? req.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  var S = {};

  /* ---- 进度（键值）---- */

  S.get = function (key) {
    return tx(KV, 'readonly', function (s) { return s.get(key); })
      ['catch'](function () {
        // 退回 localStorage
        try {
          var v = localStorage.getItem('cpdb:' + key);
          return v === null ? undefined : JSON.parse(v);
        } catch (e) { return undefined; }
      });
  };

  S.set = function (key, val) {
    return tx(KV, 'readwrite', function (s) { return s.put(val, key); })
      ['catch'](function () {
        try {
          localStorage.setItem('cpdb:' + key, JSON.stringify(val));
          return true;
        } catch (e) {
          // localStorage 通常只有 5MB，存不下就算了，不要因此报错打断用户
          return false;
        }
      });
  };

  S.del = function (key) {
    return tx(KV, 'readwrite', function (s) { return s['delete'](key); })
      ['catch'](function () {
        try { localStorage.removeItem('cpdb:' + key); } catch (e) {}
      });
  };

  /* ---- 图片二进制 ---- */

  var MAX_CACHE_ONE = 20 * 1024 * 1024;   // 单张超过 20MB 就不缓存了，不值当

  S.getBlob = function (url) {
    if (!url) return Promise.resolve(null);
    return tx(BLOBS, 'readonly', function (s) { return s.get(url); })
      .then(function (rec) { return rec && rec.blob ? rec.blob : null; })
      ['catch'](function () { return null; });
  };

  S.putBlob = function (url, blob) {
    if (!url || !blob || blob.size > MAX_CACHE_ONE || /^data:/i.test(url)) {
      return Promise.resolve(false);
    }
    return tx(BLOBS, 'readwrite', function (s) {
      return s.put({ blob: blob, size: blob.size, time: Date.now() }, url);
    }).then(function () { return true; })
      ['catch'](function () { return false; });   // 配额满了就静静地不缓存
  };

  S.clearBlobs = function () {
    return tx(BLOBS, 'readwrite', function (s) { return s.clear(); })['catch'](function () {});
  };

  S.clearAll = function () {
    return Promise.all([
      S.clearBlobs(),
      tx(KV, 'readwrite', function (s) { return s.clear(); })['catch'](function () {})
    ]).then(function () {
      try {
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf('cpdb:') === 0) localStorage.removeItem(k);
        });
      } catch (e) {}
    });
  };

  /* 缓存了几张图 */
  S.blobCount = function () {
    return tx(BLOBS, 'readonly', function (s) { return s.count(); })
      .then(function (n) { return n || 0; })['catch'](function () { return 0; });
  };

  /* 缓存占了多少 —— 浏览器只给整个站点的估算值，够用来提示了 */
  S.usage = function () {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
    return navigator.storage.estimate()
      .then(function (e) { return { used: e.usage || 0, quota: e.quota || 0 }; })
      ['catch'](function () { return null; });
  };

  S.available = function () {
    return idb().then(function () { return true; })['catch'](function () { return false; });
  };

  global.Store = S;
})(window);
