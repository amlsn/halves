/* Halves image compression (TECH-DESIGN T15). ES module, lazy-loaded on the first "Attach" tap.
   compress(file) → {full:{blob,w,h,type}, thumb:{blob,w,h,type}, kind:'screenshot'|'photo', orig, encoder}
   - Decode with createImageBitmap(imageOrientation:'from-image') (EXIF rotation applied), <img> fallback.
   - Screenshot (PNG in, a common device screen size, or few colours): cap 2400 px, lossless WebP first.
     Photo: cap 2000 px, WebP q 0.8. Over 1 MB → quality 0.72, 0.64, 0.56, then 85 % of the size, again.
   - Thumbnail: 320 px long edge, WebP ≤ 80 KB.
   - Encoder: the canvas if it really emits WebP (Chrome, Firefox, Android); else (Safari) the vendored
     @jsquash/webp WASM in a module worker (attach-enc.js); else JPEG q 0.88 from the canvas.
   - Every path re-encodes from pixels, so EXIF/GPS never leaves the phone. */
const MAX_BYTES = 1024 * 1024, THUMB_MAX = 80 * 1024, THUMB_EDGE = 320;
const SHOT_EDGE = 2400, PHOTO_EDGE = 2000;
// Portrait sizes of common phone / tablet / laptop screens (either orientation matches).
const SCREENS = [[750, 1334], [828, 1792], [1125, 2436], [1170, 2532], [1179, 2556], [1206, 2622], [1242, 2208], [1242, 2688],
  [1284, 2778], [1290, 2796], [1320, 2868], [640, 1136], [1080, 1920], [1080, 2160], [1080, 2220], [1080, 2280], [1080, 2340],
  [1080, 2400], [1080, 2412], [1096, 2560], [1220, 2712], [1236, 2676], [1240, 2772], [1248, 2778], [1260, 2800], [1280, 2856],
  [1344, 2992], [1440, 2560], [1440, 2960], [1440, 3040], [1440, 3088], [1440, 3120], [1440, 3200], [720, 1600], [720, 1520],
  [1536, 2048], [1620, 2160], [1640, 2360], [1668, 2224], [1668, 2388], [2048, 2732], [1800, 2880], [1600, 2560], [1200, 1920],
  [1080, 1920], [1440, 2560], [2160, 3840], [1964, 3024], [2234, 3456], [1664, 2560], [900, 1440], [768, 1366], [1050, 1680], [1200, 1920]];

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const toBlob = (c, type, q) => new Promise(res => c.toBlob(b => res(b), type, q));

let webpCanvas = null;
/** Safari's toBlob silently returns PNG for 'image/webp': check what actually comes out. */
async function canvasWebp() {
  if (webpCanvas === null) {
    try { const b = await toBlob(canvas(2, 2), 'image/webp', 0.8); webpCanvas = !!b && b.type === 'image/webp'; } catch (e) { webpCanvas = false; }
  }
  return webpCanvas;
}

/* ---------- WASM WebP (Safari): module worker, so a multi-second encode never blocks typing ---------- */
let wasm = null; // Promise<{encode(imageData, opts) → Promise<ArrayBuffer>}> | false
function wasmEncoder() {
  if (wasm !== null) return wasm;
  wasm = (async () => {
    const base = new URL('./', import.meta.url).href;
    let worker = null;
    try { worker = new Worker(new URL('./attach-enc.js', import.meta.url), {type: 'module'}); } catch (e) { worker = null; }
    if (worker) {
      let seq = 0; const waits = new Map();
      worker.onmessage = e => { const w = waits.get(e.data.n); if (!w) return; waits.delete(e.data.n); e.data.err ? w.rej(new Error(e.data.err)) : w.res(e.data.buf); };
      worker.onerror = e => { for (const w of waits.values()) w.rej(new Error('encoder worker failed')); waits.clear(); };
      const call = (msg, transfer) => new Promise((res, rej) => { const n = ++seq; waits.set(n, {res, rej}); worker.postMessage({...msg, n, base}, transfer || []); });
      await call({op: 'init'});
      return {encode: (img, opts) => { const buf = img.data.buffer.slice(0); return call({op: 'encode', buf, w: img.width, h: img.height, opts}, [buf]); }};
    }
    // No module workers (very old Safari): same encoder on the main thread.
    const {loadEncoder} = await import('./attach-enc.js');
    const mod = await loadEncoder(base);
    return {encode: async (img, opts) => { const o = mod.encode(img.data, img.width, img.height, opts); return o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength); }};
  })().catch(e => { console.warn('[attach] WASM WebP unavailable, using JPEG', e); return false; });
  return wasm;
}

/** Encode a canvas. q = 'lossless' or 0..1. Returns {blob, type}. */
async function encode(c, q, enc) {
  if (enc === 'canvas') {
    // Chrome encodes lossless WebP when quality is exactly 1.
    const b = await toBlob(c, 'image/webp', q === 'lossless' ? 1 : q);
    return {blob: b, type: 'image/webp'};
  }
  if (enc === 'wasm') {
    const e = await wasmEncoder();
    if (e) {
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const opts = q === 'lossless' ? {lossless: 1, near_lossless: 60, quality: 75, method: 4, exact: 0}
        : {quality: Math.round(q * 100), method: 4, use_sharp_yuv: 1};
      try { return {blob: new Blob([await e.encode(img, opts)], {type: 'image/webp'}), type: 'image/webp'}; }
      catch (err) { console.warn('[attach] WASM encode failed, using JPEG', err); wasm = Promise.resolve(false); }
    }
  }
  // JPEG fallback: q 0.88 for "lossless" requests, else the requested quality (never above 0.88).
  const jq = q === 'lossless' ? 0.88 : Math.min(0.88, q + 0.08);
  return {blob: await toBlob(c, 'image/jpeg', jq), type: 'image/jpeg'};
}

async function pickEncoder() {
  if (await canvasWebp()) return 'canvas';
  return (await wasmEncoder()) ? 'wasm' : 'jpeg';
}

/* ---------- decode + resize ---------- */
async function decode(file) {
  try { return await createImageBitmap(file, {imageOrientation: 'from-image'}); } catch (e) {}
  try { return await createImageBitmap(file); } catch (e) {}
  // <img> fallback (applies EXIF orientation in all current browsers)
  const u = URL.createObjectURL(file);
  try { const im = new Image(); im.src = u; await im.decode(); return im; }
  finally { setTimeout(() => URL.revokeObjectURL(u), 0); }
}
const dims = src => [src.width || src.naturalWidth, src.height || src.naturalHeight];

/** Draw `src` scaled so its long edge ≤ edge. Halves in steps first, so small text stays sharp. */
function draw(src, edge) {
  let [w, h] = dims(src);
  const s = Math.min(1, edge / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
  let cur = src;
  while (w / 2 >= tw * 1.0001 && h / 2 >= th) {
    w = Math.round(w / 2); h = Math.round(h / 2);
    const c = canvas(w, h), x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, w, h); cur = c;
  }
  const c = canvas(tw, th), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, tw, th); // transparent PNGs: white, never black (JPEG)
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, tw, th);
  return c;
}

/** Few distinct colours on a 64 px downsample, or a few colours covering most pixels → a screenshot. */
function lowColour(src) {
  const [w, h] = dims(src), s = 64 / Math.max(w, h);
  const c = canvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))), x = c.getContext('2d', {willReadFrequently: true});
  x.drawImage(src, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, hist = new Map();
  for (let i = 0; i < d.length; i += 4) { const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4); hist.set(key, (hist.get(key) || 0) + 1); }
  const n = d.length / 4, top = [...hist.values()].sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0);
  return hist.size < 300 || top / n > 0.6;
}
export function classify(file, src) {
  const [w, h] = dims(src), a = Math.min(w, h), b = Math.max(w, h);
  if (file.type === 'image/png') return 'screenshot';
  if (SCREENS.some(([sw, sh]) => sw === a && sh === b)) return 'screenshot';
  return lowColour(src) ? 'screenshot' : 'photo';
}

/** Main entry. onStage(text) gets short progress notes. */
export async function compress(file, onStage) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw Object.assign(new Error('not an image'), {code: 'bad_type'});
  onStage && onStage('Compressing…');
  const src = await decode(file);
  const kind = classify(file, src);
  const enc = await pickEncoder();
  let edge = kind === 'screenshot' ? SHOT_EDGE : PHOTO_EDGE;
  const qs = kind === 'screenshot' ? ['lossless', 0.9, 0.8, 0.72, 0.64] : [0.8, 0.72, 0.64, 0.56];
  let full = null, c = null;
  for (let round = 0; round < 6 && !full; round++) {
    c = draw(src, edge);
    for (const q of round ? qs.slice(-3) : qs) {
      const r = await encode(c, q, enc);
      if (r.blob && r.blob.size <= MAX_BYTES) { full = {...r, w: c.width, h: c.height}; break; }
    }
    edge = Math.round(Math.max(c.width, c.height) * 0.85);
  }
  if (!full) throw Object.assign(new Error('too large even after compression'), {code: 'too_large'});
  // Thumbnail from the already-reduced canvas (cheaper, same look).
  const tc = draw(c, THUMB_EDGE);
  let thumb = null;
  for (const q of [0.72, 0.6, 0.45, 0.3]) {
    const r = await encode(tc, q, enc);
    if (r.blob && r.blob.size <= THUMB_MAX) { thumb = {...r, w: tc.width, h: tc.height}; break; }
  }
  if (!thumb) throw Object.assign(new Error('thumbnail too large'), {code: 'too_large'});
  try { src.close && src.close(); } catch (e) {}
  return {full, thumb, kind, orig: file.size, encoder: enc};
}
export const _debug = {canvasWebp, pickEncoder, set webp(v) { webpCanvas = v; }};
