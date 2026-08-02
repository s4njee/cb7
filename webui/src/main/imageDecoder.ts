/**
 * @module
 * Decode Exotic Image Formats Into Browser-Safe Ones
 *
 * Architecture overview for Junior Devs:
 * Some comic pages use formats browsers can't display (currently JPEG XL, .jxl).
 * This module converts those into something safe: it decodes JXL to raw RGBA via
 * the `@jsquash/jxl` WebAssembly module, then re-encodes to PNG with Sharp.
 *
 * Performance note: the WASM module is loaded lazily the first time a .jxl page
 * is seen, then reused. Every other format passes through untouched.
 */

let jxlModulePromise: Promise<unknown> | null = null;

/**
 * Lazily import the `@jsquash/jxl` decoder, importing it only once.
 * The package caches its WebAssembly compilation internally on first
 * decode, so we only need to guarantee the JS module is imported a single time.
 * @returns The decode function that turns a JXL buffer into `ImageData`.
 */
async function loadJxl(): Promise<(buffer: ArrayBuffer) => Promise<ImageData>> {
  if (!jxlModulePromise) {
    jxlModulePromise = import('@jsquash/jxl/decode')
      .then((m) => m.default ?? m)
      .catch((err) => {
        // Reset on failure so a later attempt can try again — useful if
        // the wasm load was transient (e.g., disk I/O hiccup on first run).
        jxlModulePromise = null;
        throw err;
      });
  }
  return jxlModulePromise as Promise<(buffer: ArrayBuffer) => Promise<ImageData>>;
}

let sharpModule: typeof import('sharp') | null = null;
function getSharp(): typeof import('sharp') {
  if (!sharpModule) sharpModule = require('sharp');
  return sharpModule!;
}

function normalizeExt(ext: string): string {
  return ext.toLowerCase().replace(/^\./, '');
}

export function needsDecoding(extension: string): boolean {
  return normalizeExt(extension) === 'jxl';
}

export async function decode(buffer: Buffer, extension: string): Promise<Buffer> {
  if (!needsDecoding(extension)) return buffer;

  const decodeJxl = await loadJxl();
  // jsquash's decoder takes an ArrayBuffer; slice gives us a fresh one
  // covering only this Buffer's bytes (Node Buffers often share a pooled
  // backing store).
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const image = await decodeJxl(ab as ArrayBuffer);

  // Re-encode RGBA → PNG so the renderer / browser can display it.
  return await getSharp()(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  }).png().toBuffer();
}
