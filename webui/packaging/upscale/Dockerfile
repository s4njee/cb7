# cb8-upscale — Real-ESRGAN comic-page upscaler (GPU service for mars).
#
# Pinned to a torch 2.0.1 / cu117 base: it ships torchvision 0.15.2, which still
# has `torchvision.transforms.functional_tensor` — basicsr 1.4.2 imports it, and
# newer torchvision (>=0.17) removed it, so this combo avoids the well-known
# basicsr import break without a runtime shim. cu117 is fine for the 3090 (sm_86).
FROM pytorch/pytorch:2.0.1-cuda11.7-cudnn8-runtime

# cv2 runtime deps + wget for the model weights.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 wget \
    && rm -rf /var/lib/apt/lists/*

# basicsr/realesrgan are built against NumPy 1.x; pin numpy<2 so pip doesn't pull
# NumPy 2.x (which crashes those C extensions at import).
RUN pip install --no-cache-dir \
      "numpy==1.26.4" \
      basicsr==1.4.2 \
      realesrgan==0.3.0 \
      opencv-python-headless==4.9.0.80 \
      fastapi==0.111.0 \
      "uvicorn[standard]==0.30.1"

# Bake the anime/manga model weights (~18MB) so the container is self-contained
# (no runtime download dependency).
RUN mkdir -p /weights && wget -q -O /weights/RealESRGAN_x4plus_anime_6B.pth \
      https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth

WORKDIR /app
COPY app.py /app/app.py

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
