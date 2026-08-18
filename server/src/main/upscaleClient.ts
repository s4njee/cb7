/**
 * @module
 * Client for the GPU upscaling service (Real-ESRGAN on the mars 3090), exposed
 * in-cluster. POST a page's raw image bytes, get back a 2x WebP. Mirrors
 * embedClient — endpoint is configurable via env so the model/scale can change
 * without code edits. Callers (imageResizer.getCachedOrUpscale) treat any failure
 * as "serve the normal page", so this just throws on a bad response.
 */
const UPSCALE_URL = process.env.UPSCALE_URL || 'http://cb8-upscale:8000/upscale';

/** Upscale one image. Returns the upscaled WebP bytes; throws if the service is
 *  unavailable or errors (GPU fault, mars down, etc.). */
export async function upscale(input: Buffer): Promise<Buffer> {
  const res = await fetch(UPSCALE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(input),
  });
  if (!res.ok) {
    throw new Error(`upscale endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
