/* WebP encoding with the vendored @jsquash/webp WASM (TECH-DESIGN T15). Only used where the canvas can't
   encode WebP (Safari). Runs as a module worker started by attach.js; also importable on the main thread.
   Messages in: {n, op:'init'|'encode', base, buf, w, h, opts}; out: {n, buf} or {n, err}. */
// libwebp's WebPConfig defaults (from @jsquash/webp meta.js); callers override a few.
const DEFAULTS = {quality: 75, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50, filter_strength: 60,
  filter_sharpness: 0, filter_type: 1, partitions: 0, segments: 4, pass: 1, show_compressed: 0, preprocessing: 0,
  autofilter: 0, partition_limit: 0, alpha_compression: 1, alpha_filtering: 1, alpha_quality: 100, lossless: 0,
  exact: 0, image_hint: 0, emulate_jpeg_size: 0, thread_level: 0, low_memory: 0, near_lossless: 100,
  use_delta_palette: 0, use_sharp_yuv: 0};
// WASM SIMD probe (same bytes as wasm-feature-detect's simd()).
const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

let mod = null;
export function loadEncoder(base) {
  if (mod) return mod;
  mod = (async () => {
    let simd = false; try { simd = WebAssembly.validate(SIMD); } catch (e) {}
    const file = simd ? 'webp_enc_simd' : 'webp_enc';
    const {default: factory} = await import(new URL(`vendor/jsquash-webp/${file}.js`, base).href);
    const m = await factory({noInitialRun: true});
    return {encode: (data, w, h, opts) => {
      const out = m.encode(data, w, h, {...DEFAULTS, ...opts});
      if (!out) throw new Error('Encoding error.');
      return out;
    }};
  })();
  mod.catch(() => { mod = null; });
  return mod;
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async e => {
    const {n, op, base, buf, w, h, opts} = e.data;
    try {
      const enc = await loadEncoder(base);
      if (op === 'init') return self.postMessage({n, buf: null});
      const out = enc.encode(new Uint8ClampedArray(buf), w, h, opts);
      const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
      self.postMessage({n, buf: ab}, [ab]);
    } catch (err) {
      self.postMessage({n, err: String(err && err.message || err)});
    }
  };
}
