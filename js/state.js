(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { config: require('./config.js') } : { config: root.RouteLab.config };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.state = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var MAX = deps.config.MAX_HASH_LENGTH;

  function toBase64Url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function encodeState(config) {
    var json = JSON.stringify({ v: 1, config: config });
    return '#s=' + toBase64Url(new TextEncoder().encode(json));
  }

  function decodeState(hash) {
    try {
      if (typeof hash !== 'string' || hash === '' || hash === '#') return { ok: false, error: 'empty' };
      if (hash.length > MAX) return { ok: false, error: 'too-long' };
      if (hash.slice(0, 3) !== '#s=') return { ok: false, error: 'format' };
      var b64 = hash.slice(3);
      if (!/^[A-Za-z0-9_-]*$/.test(b64) || b64.length % 4 === 1) return { ok: false, error: 'base64' };
      b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      var bin;
      try { bin = atob(b64); } catch (e) { return { ok: false, error: 'base64' }; }
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return { ok: false, error: 'utf8' }; }
      var obj;
      try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'json' }; }
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || obj.v !== 1 ||
        obj.config === null || typeof obj.config !== 'object' || Array.isArray(obj.config)) return { ok: false, error: 'shape' };
      return { ok: true, config: obj.config };
    } catch (e) {
      return { ok: false, error: 'format' };
    }
  }

  return { encodeState: encodeState, decodeState: decodeState };
});
