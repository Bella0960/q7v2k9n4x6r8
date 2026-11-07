/* Dependency-free QR encoder for short MAOMAO friend IDs.
 * Fixed to QR Version 3-M (29x29); enough for the public friend-ID payload.
 */
(function (global) {
  'use strict';
  var VERSION = 3;
  var SIZE = 17 + VERSION * 4;
  var DATA_CODEWORDS = 44;
  var ECC_CODEWORDS = 26;
  var PREFIX = 'MAOMAO-F1:';

  function gfMul(x, y) {
    var z = 0;
    while (y) {
      if (y & 1) z ^= x;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
      y >>>= 1;
    }
    return z;
  }

  function generatorPoly(degree) {
    var polynomial = [1];
    for (var i = 0; i < degree; i += 1) {
      var next = new Array(polynomial.length + 1).fill(0);
      for (var j = 0; j < polynomial.length; j += 1) {
        next[j] ^= polynomial[j];
        next[j + 1] ^= gfMul(polynomial[j], 1 << i);
      }
      polynomial = next;
    }
    return polynomial;
  }

  function rsRemainder(data, degree) {
    var generator = generatorPoly(degree);
    var work = data.concat(new Array(degree).fill(0));
    for (var i = 0; i < data.length; i += 1) {
      var coefficient = work[i];
      if (!coefficient) continue;
      for (var j = 0; j < generator.length; j += 1) {
        work[i + j] ^= gfMul(generator[j], coefficient);
      }
    }
    return work.slice(data.length);
  }

  function appendBits(target, value, length) {
    for (var i = length - 1; i >= 0; i -= 1) target.push((value >>> i) & 1);
  }

  function encodeData(text) {
    var bytes = Array.from(new TextEncoder().encode(text));
    if (bytes.length > 42) throw new Error('好友二维码内容过长');
    var bits = [];
    appendBits(bits, 4, 4); // byte mode
    appendBits(bits, bytes.length, 8);
    bytes.forEach(function (byte) { appendBits(bits, byte, 8); });
    appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var words = [];
    for (var i = 0; i < bits.length; i += 8) {
      var value = 0;
      for (var j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
      words.push(value);
    }
    for (var pad = 0; words.length < DATA_CODEWORDS; pad += 1) {
      words.push(pad % 2 ? 0x11 : 0xec);
    }
    return words;
  }

  function encode(payload) {
    var data = encodeData(payload);
    var codewords = data.concat(rsRemainder(data, ECC_CODEWORDS));
    var bits = [];
    codewords.forEach(function (byte) { appendBits(bits, byte, 8); });

    var matrix = Array.from({ length: SIZE }, function () { return new Array(SIZE).fill(null); });
    var reserved = Array.from({ length: SIZE }, function () { return new Array(SIZE).fill(false); });
    function set(y, x, value) {
      if (y < 0 || y >= SIZE || x < 0 || x >= SIZE) return;
      matrix[y][x] = Boolean(value);
      reserved[y][x] = true;
    }
    function finder(centerY, centerX) {
      for (var dy = -1; dy <= 7; dy += 1) {
        for (var dx = -1; dx <= 7; dx += 1) {
          var y = centerY + dy, x = centerX + dx;
          if (y < 0 || y >= SIZE || x < 0 || x >= SIZE) continue;
          var inside = dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6;
          var dark = inside && (dy === 0 || dy === 6 || dx === 0 || dx === 6 ||
            (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4));
          set(y, x, dark);
        }
      }
    }
    finder(0, 0);
    finder(0, SIZE - 7);
    finder(SIZE - 7, 0);

    // Version 3 has one non-overlapping alignment pattern at (22, 22).
    for (var ay = -2; ay <= 2; ay += 1) {
      for (var ax = -2; ax <= 2; ax += 1) {
        set(22 + ay, 22 + ax, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
      }
    }
    for (var t = 8; t < SIZE - 8; t += 1) {
      if (matrix[6][t] === null) set(6, t, t % 2 === 0);
      if (matrix[t][6] === null) set(t, 6, t % 2 === 0);
    }
    for (var f = 0; f < 9; f += 1) {
      if (f !== 6) {
        set(8, f, false);
        set(f, 8, false);
      }
    }
    for (var k = 0; k < 8; k += 1) {
      set(8, SIZE - 1 - k, false);
      set(SIZE - 1 - k, 8, false);
    }
    set(SIZE - 8, 8, true);

    var bitIndex = 0;
    for (var right = SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vertical = 0; vertical < SIZE; vertical += 1) {
        var upward = ((right + 1) & 2) === 0;
        var y = upward ? SIZE - 1 - vertical : vertical;
        for (var side = 0; side < 2; side += 1) {
          var x = right - side;
          if (reserved[y][x]) continue;
          var bit = bitIndex < bits.length ? bits[bitIndex++] : 0;
          if ((y + x) % 2 === 0) bit ^= 1; // mask 0
          matrix[y][x] = Boolean(bit);
        }
      }
    }

    // M-level format information, mask pattern 0.
    var formatData = 0;
    var remainder = formatData << 10;
    for (var bitPosition = 14; bitPosition >= 10; bitPosition -= 1) {
      if ((remainder >>> bitPosition) & 1) remainder ^= 0x537 << (bitPosition - 10);
    }
    var format = ((formatData << 10) | remainder) ^ 0x5412;
    function formatBit(index) { return ((format >>> index) & 1) !== 0; }
    for (var i = 0; i <= 5; i += 1) set(i, 8, formatBit(i));
    set(7, 8, formatBit(6));
    set(8, 8, formatBit(7));
    set(8, 7, formatBit(8));
    for (var j = 9; j < 15; j += 1) set(8, 14 - j, formatBit(j));
    for (var p = 0; p < 8; p += 1) set(8, SIZE - 1 - p, formatBit(p));
    for (var q = 8; q < 15; q += 1) set(SIZE - 15 + q, 8, formatBit(q));
    set(SIZE - 8, 8, true);
    return matrix;
  }

  function toSvg(value) {
    var text = PREFIX + String(value || '').trim();
    var matrix = encode(text);
    var path = '';
    for (var y = 0; y < SIZE; y += 1) {
      for (var x = 0; x < SIZE; x += 1) {
        if (matrix[y][x]) path += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37" role="img" aria-label="MAOMAO 好友二维码" shape-rendering="crispEdges">' +
      '<rect width="37" height="37" fill="#fff"/><path d="' + path + '" fill="#111"/></svg>';
  }

  function parse(text) {
    var value = String(text || '').trim();
    if (value.indexOf(PREFIX) === 0) return value.slice(PREFIX.length);
    return value;
  }

  global.MaomaoFriendQr = { toSvg: toSvg, parse: parse, prefix: PREFIX };
})(typeof window !== 'undefined' ? window : self);
