// tests/make-fixtures.mjs — builds real fixtures with AI metadata inside.
// Deps: ffmpeg/ffprobe on PATH. Run: node tests/make-fixtures.mjs
import { execFileSync } from 'node:child_process';
import { requireMediaTools } from './lib/tools.mjs';

requireMediaTools();
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fx = resolve(here, 'fixtures');
const tmp = resolve(here, '.tmp');
mkdirSync(fx, { recursive: true });
mkdirSync(tmp, { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

// ---------- box / segment helpers ----------
const box = (type, payload) => {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(8 + payload.length, 0);
  b.write(type, 4, 'latin1');
  payload.copy(b, 8);
  return b;
};
const uuidBox = (uuid, payload) => box('uuid', Buffer.concat([Buffer.from(uuid.replace(/-/g, ''), 'hex'), payload]));
const freeBox = (n) => box('free', Buffer.alloc(n));
// XMP uuid per ISO 16684-1 / Adobe: BE7ACFCB-97A9-42E8-9C71-999491E3AFAC
const XMP_UUID = 'be7acfcb-97a9-42e8-9c71-999491e3afac';
// C2PA in ISO BMFF: top-level uuid() box, user-type d8fec3d6-1b0e-483c-9297-5828877ec481
const C2PA_UUID = 'd8fec3d6-1b0e-483c-9297-5828877ec481';
const emsgBox = (payload) => box('emsg', payload);

const jumbf = (inner) => box('jumb', Buffer.concat([Buffer.from([0, 0, 0, 0]), box('jumd', Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), box('json', Buffer.from(inner, 'utf8'))]));

// splice payload bytes into a top-level MP4 file after ftyp, then re-point the
// chunk offset tables (stco/co64) at the shifted mdat — the same maths the
// cleaner has to do in reverse when it removes metadata before mdat.
function injectTopLevel(file, boxes) {
  const buf = readFileSync(file);
  const typeAt = (b, o) => b.subarray(o + 4, o + 8).toString('latin1');
  const boxAt = (b, o) => b.readUInt32BE(o);
  const walk = (b, start, end, visit) => {
    let o = start;
    while (o + 8 <= end) {
      let size = boxAt(b, o);
      let header = 8;
      if (size === 1) { size = Number(b.readBigUInt64BE(o + 8)); header = 16; }
      else if (size === 0) size = end - o;
      if (size < header || o + size > end) break;
      visit(b, o, header, size);
      o += size;
    }
  };
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex', 'udta']);
  const tables = [];
  const recurse = (start, end) => walk(buf, start, end, (b, o, header, size) => {
    const t = typeAt(b, o);
    if (t === 'stco' || t === 'co64') tables.push([o, header, size, t]);
    else if (containers.has(t)) recurse(o + header, o + size);
  });
  recurse(0, buf.length);

  const ftypSize = buf.readUInt32BE(0);
  const inserted = boxes.reduce((a, b) => a + b.length, 0);
  const out = Buffer.concat([buf.subarray(0, ftypSize), ...boxes, buf.subarray(ftypSize)]);
  // patch after concat: moov lives after ftyp, so its absolute position moved by `inserted`
  for (const [o, header, size, t] of tables) {
    const boxStart = o + inserted;
    const count = out.readUInt32BE(boxStart + header + 4);
    for (let i = 0; i < count; i++) {
      const off = boxStart + header + 8 + i * (t === 'stco' ? 4 : 8);
      const val = t === 'stco' ? out.readUInt32BE(off) : Number(out.readBigUInt64BE(off));
      if (val === 0) continue;
      const next = val + inserted;
      if (t === 'stco') out.writeUInt32BE(next, off); else out.writeBigUInt64BE(BigInt(next), off);
    }
  }
  writeFileSync(file, out);
}

// ---------- MP4 / MOV / M4V fixtures ----------
const src = ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'];
const meta = ['-metadata', 'title=Veo AI clip', '-metadata', 'encoder=Google Veo 3', '-metadata', 'comment=Made with AI: prompt "a cat on a beach"', '-metadata', 'software=DALL-E 3', '-metadata', 'location=+52.6300-001.1300/'];

ff([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...meta, resolve(fx, 'ai-video.mp4')]);
ff([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...meta, '-movflags', 'use_metadata_tags', resolve(fx, 'ai-mdta.mp4')]);
ff(['-i', resolve(fx, 'ai-video.mp4'), '-c', 'copy', '-f', 'mov', resolve(fx, 'ai-video.mov')]);
ff([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...meta, '-movflags', 'frag_keyframe+empty_moov+default_base_moof', resolve(fx, 'ai-fragmented.mp4')]);
ff([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', resolve(fx, 'clean-video.mp4')]);
copyFileSync(resolve(fx, 'ai-video.mp4'), resolve(fx, 'ai-video.m4v'));
// codec-agnostic proof: the rewrite never touches the encoded streams
try {
  ff([...src, '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac', '-shortest', ...meta, resolve(fx, 'ai-hevc.mp4')]);
} catch (e) {
  console.log('note: libx265 unavailable, skipping the HEVC fixture');
}

// top-level uuid metadata + free padding + post-mdat metadata, on a copy that keeps faststart
ff([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...meta, '-movflags', '+faststart', resolve(fx, 'ai-faststart.mp4')]);
for (const f of ['ai-video.mp4', 'ai-video.mov', 'ai-video.m4v', 'ai-mdta.mp4', 'ai-faststart.mp4']) {
  injectTopLevel(resolve(fx, f), [
    freeBox(16),
    uuidBox(XMP_UUID, Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Google Veo"/></rdf:RDF></x:xmpmeta>', 'utf8')),
    uuidBox(C2PA_UUID, jumbf('{"claim_generator":"Google Veo 3 c2pa-python","title":"Generated by AI"}')),
  ]);
}
// fragmented file also carries a C2PA-flavoured emsg timed-metadata box
injectTopLevel(resolve(fx, 'ai-fragmented.mp4'), [
  uuidBox(C2PA_UUID, jumbf('{"claim_generator":"Google Veo 3"}')),
  emsgBox(Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('urn:c2pa:merkle\0', 'latin1'), Buffer.from('1\0', 'latin1'), Buffer.alloc(16), Buffer.from('c2pa merkle payload')])),
]);
// mov also gets a moov-level meta after moov (loose uuid at end)
injectTopLevel(resolve(fx, 'clean-video.mp4'), [freeBox(8)]);

// ---------- image fixtures ----------
ff(['-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=1', '-frames:v', '1', resolve(tmp, 'base.jpg')]);
ff(['-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=1', '-frames:v', '1', resolve(tmp, 'base.png')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=1', '-frames:v', '1', '-c:v', 'libwebp', resolve(tmp, 'base.webp')]);

// minimal little-endian TIFF/EXIF builder
function tiff(entries, extras = []) {
  const ifdSize = 2 + entries.length * 12 + 4;
  let dataOff = 8 + ifdSize;
  const dataChunks = [];
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(entries.length, 0);
  entries.forEach((e, i) => {
    const o = 2 + i * 12;
    ifd.writeUInt16LE(e.tag, o);
    ifd.writeUInt16LE(e.type, o + 2);
    ifd.writeUInt32LE(e.value.length, o + 4);
    if (e.value.length <= 4) {
      e.value.copy(ifd, o + 8);
      ifd.fill(0, o + 8 + e.value.length, o + 12);
    } else {
      ifd.writeUInt32LE(dataOff, o + 8);
      dataChunks.push(e.value);
      dataOff += e.value.length + (e.value.length % 2);
    }
  });
  const head = Buffer.alloc(8);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  const parts = [head, ifd];
  for (const c of dataChunks) { parts.push(c); if (c.length % 2) parts.push(Buffer.alloc(1)); }
  parts.push(...extras);
  return Buffer.concat(parts);
}
const ascii = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.alloc(1)]);
const exifPayload = tiff([
  { tag: 0x010e, type: 2, value: ascii('AI generated: a cat on a beach, seed 12345') },
  { tag: 0x010f, type: 2, value: ascii('OpenAI') },
  { tag: 0x0110, type: 2, value: ascii('DALL-E 3') },
  { tag: 0x0131, type: 2, value: ascii('Adobe Firefly') },
  { tag: 0x013b, type: 2, value: ascii('Stable Diffusion XL') },
  { tag: 0x8298, type: 2, value: ascii('Generated with ComfyUI') },
  { tag: 0x9286, type: 7, value: Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from('prompt: a cat. Made with Midjourney', 'utf8')]) },
  { tag: 0x8825, type: 4, value: Buffer.from([0, 0, 0, 0]) },
]);

function jpegInsert(file, segments) {
  const buf = readFileSync(file);
  if (buf.readUInt16BE(0) !== 0xffd8) throw new Error('not jpeg');
  const out = Buffer.concat([buf.subarray(0, 2), ...segments, buf.subarray(2)]);
  writeFileSync(file, out);
}
const appSeg = (marker, payload) => {
  const s = Buffer.alloc(4 + payload.length);
  s.writeUInt16BE(0xff00 | marker, 0);
  s.writeUInt16BE(2 + payload.length, 2);
  payload.copy(s, 4);
  return s;
};
jpegInsert(resolve(tmp, 'base.jpg'), [
  appSeg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifPayload])),
  appSeg(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Midjourney v7"/></rdf:RDF></x:xmpmeta>', 'utf8')])),
  appSeg(0xeb, Buffer.concat([Buffer.from('JP', 'latin1'), jumbf('{"claim_generator":"OpenAI DALL-E 3 c2pa"')])),
]);
copyFileSync(resolve(tmp, 'base.jpg'), resolve(fx, 'ai-photo.jpg'));
copyFileSync(resolve(tmp, 'base.png'), resolve(fx, 'ai-photo.png'));

// PNG chunk injection: tEXt + iTXt + caBX (C2PA)
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0);
  return Buffer.concat([head, data, crc]);
};
function pngInsert(file, chunks) {
  const buf = readFileSync(file);
  const ihdrSize = buf.readUInt32BE(8);
  const afterIhdr = 8 + 12 + ihdrSize;
  writeFileSync(file, Buffer.concat([buf.subarray(0, afterIhdr), ...chunks, buf.subarray(afterIhdr)]));
}
pngInsert(resolve(fx, 'ai-photo.png'), [
  pngChunk('tEXt', Buffer.from('Software\0Stable Diffusion XL 1.0', 'latin1')),
  pngChunk('tEXt', Buffer.from('parameters\na cat on a beach, seed 12345, Steps: 30, Sampler: DPM++ 2M\nNegative prompt: blurry\nModel: flux-dev', 'latin1')),
  pngChunk('iTXt', Buffer.from('workflow\0\0\0\0\0{"1":{"class_type":"KSampler"},"prompt":"ComfyUI graph"}', 'latin1')),
  pngChunk('caBX', jumbf('{"claim_generator":"ComfyUI c2pa"')),
]);
// webp: EXIF + XMP RIFF chunks
// A WebP carrying EXIF/XMP chunks must advertise them in a VP8X header, or decoders
// reject the file — build or update that header, then splice the chunks in right after it.
function webpChunks(buf) {
  const out = [];
  let p = 12;
  while (p + 8 <= buf.length) {
    const type = buf.subarray(p, p + 4).toString('latin1');
    const len = buf.readUInt32LE(p + 4);
    if (p + 8 + len > buf.length) break;
    out.push({ type, data: buf.subarray(p + 8, p + 8 + len), raw: buf.subarray(p, p + 8 + len + (len % 2)) });
    p += 8 + len + (len % 2);
  }
  return out;
}
function webpSize(chunks) {
  for (const c of chunks) {
    if (c.type === 'VP8X') return [1 + (c.data[4] | (c.data[5] << 8) | (c.data[6] << 16)), 1 + (c.data[7] | (c.data[8] << 8) | (c.data[9] << 16))];
    if (c.type === 'VP8 ') return [c.data.readUInt16LE(6) & 0x3fff, c.data.readUInt16LE(8) & 0x3fff];
    if (c.type === 'VP8L') { const bits = c.data.readUInt32LE(1); return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]; }
  }
  return [640, 480];
}
function webpInsert(file, chunks) {
  const buf = readFileSync(file);
  const all = webpChunks(buf);
  const existing = all.find((c) => c.type === 'VP8X');
  const [width, height] = webpSize(all);
  const flags = (existing ? existing.data[0] : 0) | 0x08 | 0x04; // EXIF + XMP
  const vp8xData = Buffer.alloc(10);
  vp8xData[0] = flags;
  vp8xData.writeUIntLE(width - 1, 4, 3);
  vp8xData.writeUIntLE(height - 1, 7, 3);
  const vp8x = Buffer.concat([Buffer.from('VP8X', 'latin1'), Buffer.from([10, 0, 0, 0]), vp8xData]);
  const rest = all.filter((c) => c.type !== 'VP8X').map((c) => c.raw);
  const out = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), vp8x, ...chunks, ...rest]);
  out.writeUInt32LE(out.length - 8, 4);
  writeFileSync(file, out);
}
const riffChunk = (type, data) => {
  const h = Buffer.alloc(8);
  h.write(type, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([h, data, pad]);
};
webpInsert(resolve(tmp, 'base.webp'), [
  riffChunk('EXIF', exifPayload),
  riffChunk('XMP ', Buffer.from('<x:xmpmeta xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="trainedAlgorithmicMedia" xmp:CreatorTool="Firefly"/>', 'utf8')),
]);
copyFileSync(resolve(tmp, 'base.webp'), resolve(fx, 'ai-photo.webp'));

// every fixture must be readable by an independent decoder, or the tests are worthless
for (const name of readdirSync(fx)) {
  try {
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,stream=codec_name,width,height', '-of', 'json', resolve(fx, name)], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (/\.(jpg|png|webp)$/i.test(name)) execFileSync('ffmpeg', ['-v', 'error', '-i', resolve(fx, name), '-frames:v', '1', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`fixture ${name} is not decodable: ${((e.stderr || '') + (e.stdout || '')).trim().slice(0, 200)}`);
  }
}
console.log('fixtures written to', fx, '(all', readdirSync(fx).length, 'validated)');
