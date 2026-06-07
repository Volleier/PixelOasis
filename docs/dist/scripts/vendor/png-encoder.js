/* vendor/png-encoder.js — Pure-JS PNG encoder for UXP
 *
 * Produces valid PNGs without relying on Adobe imaging.encodeImageData,
 * whose PNG output is documented primarily as a JPEG/base64 helper and
 * whose alpha-channel fidelity is not guaranteed by the API contract.
 *
 * Compression: Deflate stored blocks (BTYPE=00).
 *   Correct, self-contained, and produces valid PNG bytes without zlib.
 *   Trade-off: no LZ77 compression → output is ~raw-size.
 *   Future: upgrade to fixed-Huffman (BTYPE=01) or full LZ77 if upload
 *   size becomes a bottleneck.
 *
 * Color-type constants (PNG spec):
 *   2 — RGB  (3 bytes / pixel)
 *   6 — RGBA (4 bytes / pixel)
 *
 * Usage:
 *   var b64 = window.PO.PngEncoder.encode(width, height, pixelData, 6);
 *   // pixelData is a Uint8Array in row-major order, samples interleaved.
 */

window.PO = window.PO || {};

window.PO.PngEncoder = (function () {
  "use strict";

  /* ── CRC-32 (IEEE 802.3 polynomial, reflected) ── */

  var crcTable = new Uint32Array(256);
  (function buildCrcTable() {
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
  })();

  function crc32(data, offset, length) {
    var crc = 0xFFFFFFFF;
    for (var i = offset; i < offset + length; i++) {
      crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ── Adler-32 (zlib checksum) ── */
  /* s1 and s2 are MOD 65521.  We update per-byte but reduce periodically. */

  function adler32(data, offset, length) {
    var s1 = 1;
    var s2 = 0;
    var end = offset + length;
    for (var i = offset; i < end; i++) {
      s1 = (s1 + data[i]) % 65521;
      s2 = (s2 + s1) % 65521;
    }
    return ((s2 << 16) | s1) >>> 0;
  }

  /* ── Base64 encode (Uint8Array → string) ── */

  var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function toBase64(bytes) {
    var result = "";
    var len = bytes.length;
    for (var i = 0; i < len; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < len ? bytes[i + 1] : 0;
      var b2 = i + 2 < len ? bytes[i + 2] : 0;
      var triple = (b0 << 16) | (b1 << 8) | b2;
      result += base64Chars.charAt((triple >> 18) & 0x3F);
      result += base64Chars.charAt((triple >> 12) & 0x3F);
      result += i + 1 < len ? base64Chars.charAt((triple >> 6) & 0x3F) : "=";
      result += i + 2 < len ? base64Chars.charAt(triple & 0x3F) : "=";
    }
    return result;
  }

  /* ── Deflate stored-block compressor ──
   *
   * RFC 1951 §3.2.4 — stored (BTYPE=00) blocks.
   * Each block: 1-bit BFINAL + 2-bit BTYPE + pad to byte + LEN + NLEN + data.
   * Max data per block = 65535 bytes.
   */

  var MAX_STORED_BLOCK = 65535;

  /* Returns total deflate byte count.  Writes into `out` at `outOffset`. */
  function deflateStored(data, dataOffset, dataLength, out, outOffset) {
    var pos = outOffset;
    var remaining = dataLength;
    var srcPos = dataOffset;

    while (remaining > 0) {
      var blockLen = remaining < MAX_STORED_BLOCK ? remaining : MAX_STORED_BLOCK;
      var isFinal = blockLen === remaining ? 1 : 0;

      /* Block header: 3 bits (BFINAL + BTYPE), padded to byte boundary.
       * Since we're at a fresh byte (guaranteed by previous block ending
       * on a byte boundary), we write a full byte: BFINAL << 0 | BTYPE << 1
       * Wait — in Deflate bit order (LSB first):
       *   Bit 0 = BFINAL, Bits 1-2 = BTYPE (00).
       * So the byte is just (isFinal ? 1 : 0).
       * But we're writing 8 bits starting at a byte boundary:
       *   value = (isFinal ? 1 : 0) (3 bits used, 5 padding zeros)
       * In LSB-first byte: bits 0-2 = value, bits 3-7 = 0.
       */
      out[pos] = isFinal ? 1 : 0;
      pos += 1;

      /* LEN (2 bytes, little-endian) */
      out[pos] = blockLen & 0xFF;
      out[pos + 1] = (blockLen >> 8) & 0xFF;
      pos += 2;

      /* NLEN = one's complement of LEN (2 bytes, little-endian) */
      var nlen = blockLen ^ 0xFFFF;
      out[pos] = nlen & 0xFF;
      out[pos + 1] = (nlen >> 8) & 0xFF;
      pos += 2;

      /* Copy data */
      for (var j = 0; j < blockLen; j++) {
        out[pos + j] = data[srcPos + j];
      }
      pos += blockLen;
      srcPos += blockLen;
      remaining -= blockLen;
    }

    return pos - outOffset; /* bytes written */
  }

  /* ── Zlib wrapper ──
   *
   * RFC 1950:
   *   CMF (1 byte): compression method (4 bits) + window (4 bits)
   *                 CM=8 (deflate), CINFO=7 (32K window) → 0x78
   *   FLG (1 byte): flags + check bits. 0x01 = no dict, level 0.
   *                 FCHECK makes CMF*256+FLG a multiple of 31.
   *                 0x78*256 + 0x01 = 0x7801.  0x7801 % 31 = ... let's compute:
   *                 0x7801 = 30721.  30721 / 31 = 991.  991*31 = 30721.  Yes, divisible!
   *   ... compressed data ...
   *   Adler-32 (4 bytes, big-endian)
   */

  function zlibWrap(deflated, deflatedLen, rawData, rawOffset, rawLen, out, outOffset) {
    var pos = outOffset;
    /* CMF */
    out[pos] = 0x78;
    pos += 1;
    /* FLG — level 0 (stored), FCHECK makes it divisible by 31.
     * 0x78 * 256 + 0x01 = 0x7801 ≡ 0 (mod 31), so FLG = 0x01 works. */
    out[pos] = 0x01;
    pos += 1;
    /* Deflate data */
    for (var i = 0; i < deflatedLen; i++) {
      out[pos + i] = deflated[i];
    }
    pos += deflatedLen;
    /* Adler-32 (big-endian) */
    var adler = adler32(rawData, rawOffset, rawLen);
    out[pos] = (adler >> 24) & 0xFF;
    out[pos + 1] = (adler >> 16) & 0xFF;
    out[pos + 2] = (adler >> 8) & 0xFF;
    out[pos + 3] = adler & 0xFF;
    pos += 4;
    return pos - outOffset;
  }

  /* ── 32-bit big-endian write ── */

  function writeUint32BE(buf, offset, value) {
    buf[offset] = (value >> 24) & 0xFF;
    buf[offset + 1] = (value >> 16) & 0xFF;
    buf[offset + 2] = (value >> 8) & 0xFF;
    buf[offset + 3] = value & 0xFF;
  }

  /* ── Main PNG encoder ──
   *
   * @param {number}  width     Image width in pixels
   * @param {number}  height    Image height in pixels
   * @param {Uint8Array} pixels Raw pixel data, row-major, samples interleaved
   * @param {number}  colorType 2=RGB (3 bpp), 6=RGBA (4 bpp)
   * @returns {string} Base64-encoded PNG
   */

  function encode(width, height, pixels, colorType) {
    var bytesPerPixel = colorType === 6 ? 4 : 3;
    var samplesPerPixel = bytesPerPixel; /* No palette — samples == bytes */
    var bitDepth = 8;

    /* ── Build filtered pixel data ──
     * Each row: 1 filter byte (0x00 = None) + raw pixel bytes.
     * Total raw = height * (1 + width * bytesPerPixel)
     */
    var rowLen = 1 + width * bytesPerPixel;
    var rawLen = height * rowLen;
    var raw = new Uint8Array(rawLen);
    for (var y = 0; y < height; y++) {
      /* Filter byte = 0x00 (None) */
      raw[y * rowLen] = 0;
      /* Copy pixel row */
      var srcRowStart = y * width * bytesPerPixel;
      for (var x = 0; x < width * bytesPerPixel; x++) {
        raw[y * rowLen + 1 + x] = pixels[srcRowStart + x];
      }
    }

    /* ── Deflate ──
     * Worst-case deflated size: ~rawLen + (rawLen / 65535 + 1) * 5
     * Each stored block adds 5 header bytes per ≤65535 bytes.
     */
    var maxDeflated = rawLen + Math.ceil(rawLen / MAX_STORED_BLOCK) * 5;
    var deflated = new Uint8Array(maxDeflated);
    var deflatedLen = deflateStored(raw, 0, rawLen, deflated, 0);

    /* ── Zlib ──
     * Zlib header (2) + deflate data + Adler-32 (4)
     */
    var zlibLen = 2 + deflatedLen + 4;
    var zlib = new Uint8Array(zlibLen);
    zlibWrap(deflated, deflatedLen, raw, 0, rawLen, zlib, 0);

    /* ── PNG assembly ── */

    /* Signature (8 bytes) */
    var signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    /* IHDR (25 bytes) */
    var ihdr = new Uint8Array(25);
    writeUint32BE(ihdr, 0, 13); /* data length */
    ihdr[4] = 73; ihdr[5] = 72; ihdr[6] = 68; ihdr[7] = 82; /* "IHDR" */
    writeUint32BE(ihdr, 8, width);
    writeUint32BE(ihdr, 12, height);
    ihdr[16] = bitDepth;    /* bit depth */
    ihdr[17] = colorType;   /* color type */
    ihdr[18] = 0;           /* compression (0 = deflate) */
    ihdr[19] = 0;           /* filter method (0 = adaptive with 5 types) */
    ihdr[20] = 0;           /* interlace (0 = none) */
    writeUint32BE(ihdr, 21, crc32(ihdr, 4, 17));

    /* IDAT (12 + zlibLen bytes) */
    var idatDataLen = zlibLen;
    var idat = new Uint8Array(12 + idatDataLen);
    writeUint32BE(idat, 0, idatDataLen);
    idat[4] = 73; idat[5] = 68; idat[6] = 65; idat[7] = 84; /* "IDAT" */
    for (var i2 = 0; i2 < idatDataLen; i2++) {
      idat[8 + i2] = zlib[i2];
    }
    writeUint32BE(idat, 8 + idatDataLen, crc32(idat, 4, 4 + idatDataLen));

    /* IEND (12 bytes) */
    var iend = new Uint8Array(12);
    writeUint32BE(iend, 0, 0); /* data length = 0 */
    iend[4] = 73; iend[5] = 69; iend[6] = 78; iend[7] = 68; /* "IEND" */
    writeUint32BE(iend, 8, crc32(iend, 4, 4));

    /* Concatenate */
    var pngLen = signature.length + ihdr.length + idat.length + iend.length;
    var png = new Uint8Array(pngLen);
    var pos = 0;
    png.set(signature, pos); pos += signature.length;
    png.set(ihdr, pos);      pos += ihdr.length;
    png.set(idat, pos);      pos += idat.length;
    png.set(iend, pos);      /* pos += iend.length; */

    return toBase64(png);
  }

  return { encode: encode };
})();
