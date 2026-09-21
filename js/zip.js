/* 极简 ZIP 打包（store，不压缩）—— 图片本来就压过了，再压也省不了多少
   自己实现是为了不引任何 CDN，断网 / 本地双击也能用 */
(function (global) {
  'use strict';

  var TABLE = (function () {
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(d) {
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF,
      date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
    };
  }

  function toBytes(data) {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new Error('不支持的数据类型');
  }

  function w16(a, v) { a.push(v & 0xFF, (v >>> 8) & 0xFF); }
  function w32(a, v) { a.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); }

  /* files: [{ name, data: string | Uint8Array | ArrayBuffer }] -> Blob */
  function build(files) {
    var parts = [], central = [], offset = 0;
    var now = dosTime(new Date());
    var enc = new TextEncoder();

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var data = toBytes(f.data);
      var crc = crc32(data);
      var local = [];
      w32(local, 0x04034b50);
      w16(local, 20);          // version needed
      w16(local, 0x0800);      // flag: 文件名 UTF-8
      w16(local, 0);           // method: store
      w16(local, now.time);
      w16(local, now.date);
      w32(local, crc);
      w32(local, data.length);
      w32(local, data.length);
      w16(local, nameBytes.length);
      w16(local, 0);
      var localHeader = new Uint8Array(local);
      parts.push(localHeader, nameBytes, data);

      var c = [];
      w32(c, 0x02014b50);
      w16(c, 0x031E);          // version made by
      w16(c, 20);
      w16(c, 0x0800);
      w16(c, 0);
      w16(c, now.time);
      w16(c, now.date);
      w32(c, crc);
      w32(c, data.length);
      w32(c, data.length);
      w16(c, nameBytes.length);
      w16(c, 0); w16(c, 0); w16(c, 0); w16(c, 0);
      w32(c, 0);               // external attrs
      w32(c, offset);
      central.push(new Uint8Array(c), nameBytes);

      offset += localHeader.length + nameBytes.length + data.length;
    });

    var centralSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var end = [];
    w32(end, 0x06054b50);
    w16(end, 0); w16(end, 0);
    w16(end, files.length); w16(end, files.length);
    w32(end, centralSize);
    w32(end, offset);
    w16(end, 0);

    return new Blob(parts.concat(central, [new Uint8Array(end)]), { type: 'application/zip' });
  }

  global.Zip = { build: build, crc32: crc32 };
})(window);
