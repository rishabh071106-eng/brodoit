# Bro Core GPU voice: Chatterbox Multilingual (MIT, 23 languages) as a RunPod serverless worker.
# Bro's one deep voice is cloned from reference clips we generated ourselves with Bro's CPU voice (Kokoro am_onyx),
# so the same voice speaks every language. No third-party voice is copied.
import base64
import io
import time

import runpod
import torch
import torchaudio
from chatterbox.mtl_tts import ChatterboxMultilingualTTS, SUPPORTED_LANGUAGES

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
MODEL = ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)
# a reference clip in the same language as the output keeps the accent natural; others use the English one
REFS = {'en': '/app/bro_ref_en.wav', 'hi': '/app/bro_ref_hi.wav'}


def handler(job):
    inp = job.get('input') or {}
    if inp.get('ping'):
        return {'ok': True, 'device': DEVICE, 'languages': sorted(SUPPORTED_LANGUAGES)}
    text = str(inp.get('text') or '').strip()[:1200]
    if not text:
        return {'error': 'empty text'}
    lang = str(inp.get('lang') or 'en').split('-')[0].lower()
    if lang not in SUPPORTED_LANGUAGES:
        lang = 'en'
    started = time.time()
    with torch.inference_mode():
        wav = MODEL.generate(
            text,
            language_id=lang,
            audio_prompt_path=REFS.get(lang, REFS['en']),
            exaggeration=float(inp.get('exaggeration', 0.5)),
            cfg_weight=float(inp.get('cfg', 0.5)),
        )
    buf = io.BytesIO()
    torchaudio.save(buf, wav.cpu(), MODEL.sr, format='wav')
    return {
        'audio': base64.b64encode(buf.getvalue()).decode(),
        'mime': 'audio/wav',
        'sr': MODEL.sr,
        'ms': int((time.time() - started) * 1000),
    }


runpod.serverless.start({'handler': handler})
