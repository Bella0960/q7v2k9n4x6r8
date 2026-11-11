(function (root) {
  'use strict';
  var CODE_PATTERN = /^[a-f0-9]{64}$/i;
  var HASH_PATTERN = /^#mao-friend=([a-f0-9]{64})$/i;
  var LEGACY_PATTERN = /^mao:\/\/friend\/add\?code=([a-f0-9]{64})$/i;
  function currentUrl(locationLike) {
    if (!locationLike) throw new Error('location_required');
    if (locationLike.href) return new URL(locationLike.href);
    return new URL(String(locationLike.pathname || '/'), String(locationLike.origin || ''));
  }
  function isSecure(url) {
    return url.protocol === 'https:' ||
      (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'));
  }
  function createShareUrl(locationLike, value) {
    var code = String(value == null ? '' : value).trim();
    if (!CODE_PATTERN.test(code)) throw new Error('invalid_friend_code');
    var base = currentUrl(locationLike);
    if (!isSecure(base)) throw new Error('https_required');
    var share = new URL(base.pathname, base.origin);
    share.hash = 'mao-friend=' + code.toLowerCase();
    return share.href;
  }
  function extractFriendCode(value, locationLike) {
    var input = String(value == null ? '' : value).trim();
    if (CODE_PATTERN.test(input)) return input.toLowerCase();
    var legacy = input.match(LEGACY_PATTERN);
    if (legacy) return legacy[1].toLowerCase();
    if (!input || !locationLike) return '';
    try {
      var base = currentUrl(locationLike);
      if (!isSecure(base)) return '';
      var parsed = new URL(input, base.origin);
      if (!isSecure(parsed) || parsed.origin !== base.origin || parsed.pathname !== base.pathname ||
          parsed.search || parsed.username || parsed.password) return '';
      var match = parsed.hash.match(HASH_PATTERN);
      return match ? match[1].toLowerCase() : '';
    } catch (error) { return ''; }
  }
  function captureCurrentInvite(locationLike, historyLike, title) {
    if (!locationLike || !locationLike.hash) return '';
    var code = extractFriendCode(locationLike.href, locationLike);
    if (!code) return '';
    if (historyLike && typeof historyLike.replaceState === 'function') {
      var cleanPath = String(locationLike.pathname || '/') + String(locationLike.search || '');
      historyLike.replaceState(null, String(title || ''), cleanPath);
    }
    return code;
  }
  function getQrPayload(serverPayload, shareUrl, locationLike) {
    var expectedCode = String(serverPayload && serverPayload.code || '').trim().toLowerCase();
    var payload = String(serverPayload && serverPayload.qrPayload || '').trim();
    if (!CODE_PATTERN.test(expectedCode)) throw new Error('invalid_friend_qr_payload');
    // Standard phone cameras can open HTTPS, unlike an unregistered mao:// scheme.
    // Keep accepting the legacy value, but never embed it in a newly rendered QR.
    if (payload && extractFriendCode(payload) !== expectedCode) {
      throw new Error('invalid_friend_qr_payload');
    }
    if (extractFriendCode(shareUrl, locationLike) !== expectedCode) {
      throw new Error('invalid_friend_qr_payload');
    }
    return String(shareUrl);
  }
  root.PhoneRealUserInviteLinks = {
    createShareUrl: createShareUrl,
    extractFriendCode: extractFriendCode,
    captureCurrentInvite: captureCurrentInvite,
    getQrPayload: getQrPayload
  };
})(window);
