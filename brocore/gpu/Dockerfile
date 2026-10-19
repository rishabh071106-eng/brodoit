# Bro Core GPU voice worker (RunPod serverless). Built by .github/workflows/brocore-gpu.yml into GHCR.
# The model weights are baked into the image so a cold worker doesn't download them.
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 HF_HOME=/models/hf

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# chatterbox-tts pins torch 2.6.0, the version this base image already has
RUN pip install --no-cache-dir "chatterbox-tts==0.1.7" "runpod>=1.7,<2"

RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('ResembleAI/chatterbox', allow_patterns=['ve.pt','t3_mtl23ls_v2.safetensors','s3gen.pt','grapheme_mtl_merged_expanded_v1.json','conds.pt','Cangjie5_TC.json'])"

WORKDIR /app
COPY handler.py bro_ref_en.wav bro_ref_hi.wav /app/

CMD ["python", "-u", "/app/handler.py"]
