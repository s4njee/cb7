"""
cb8-upscale — a tiny GPU upscaling service (Real-ESRGAN) for comic pages.

The CB8 API POSTs a raw page image to /upscale and gets back a 2x WebP. Mirrors
the role of the TEI embeddings service: one model loaded once on the mars 3090,
called in-cluster, results cached by the caller.

Model: RealESRGAN_x4plus_anime_6B (a x4 RRDBNet with 6 blocks — small + fast,
tuned for anime/manga/comic line art). We run it at outscale=2 (the 4x result is
downsampled to 2x), which is the sweet spot for screen reading vs. file size.
"""
import os
import cv2
import numpy as np
from fastapi import FastAPI, Request, Response, HTTPException
from basicsr.archs.rrdbnet_arch import RRDBNet
from realesrgan import RealESRGANer

MODEL_PATH = os.environ.get("UPSCALE_MODEL_PATH", "/weights/RealESRGAN_x4plus_anime_6B.pth")
OUTSCALE = float(os.environ.get("UPSCALE_OUTSCALE", "2"))
TILE = int(os.environ.get("UPSCALE_TILE", "256"))          # tile to bound VRAM
MAX_OUT_DIM = int(os.environ.get("UPSCALE_MAX_OUT_DIM", "6000"))  # cap output px
WEBP_QUALITY = int(os.environ.get("UPSCALE_WEBP_QUALITY", "82"))

# anime_6B is an RRDBNet with num_block=6 (the x4plus general model uses 23).
_model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=6, num_grow_ch=32, scale=4)
_upsampler = RealESRGANer(
    scale=4,
    model_path=MODEL_PATH,
    model=_model,
    tile=TILE,
    tile_pad=10,
    pre_pad=0,
    half=True,   # fp16 on the 3090
    gpu_id=0,
)

app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upscale")
async def upscale(request: Request):
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="empty body")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="could not decode image")

    # Keep the upscaled output within MAX_OUT_DIM: if 2x would exceed it, pre-shrink
    # the input so we never produce an absurdly large page.
    h, w = img.shape[:2]
    outscale = OUTSCALE
    longest_out = max(h, w) * outscale
    if longest_out > MAX_OUT_DIM:
        outscale = MAX_OUT_DIM / max(h, w)

    try:
        output, _ = _upsampler.enhance(img, outscale=outscale)
    except Exception as e:  # GPU/CUDA fault, OOM, etc. — surface as 503 so the
        raise HTTPException(status_code=503, detail=f"upscale failed: {e}")  # caller can fall back

    ok, buf = cv2.imencode(".webp", output, [cv2.IMWRITE_WEBP_QUALITY, WEBP_QUALITY])
    if not ok:
        raise HTTPException(status_code=500, detail="encode failed")
    return Response(content=buf.tobytes(), media_type="image/webp")
