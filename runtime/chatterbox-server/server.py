import asyncio
import io
import json
import os
import random
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


VOICE_DIR = Path(os.environ["CHATTERBOX_VOICE_DIR"]).resolve()


def load_voice_files() -> dict[str, Path]:
    catalog_path = VOICE_DIR / "synthetic" / "catalog.json"
    if not catalog_path.is_file():
        raise RuntimeError(
            f"Missing synthetic voice catalog {catalog_path}. "
            "Run runtime/voice-casting/generate_candidates.py first."
        )
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    return {
        item["id"]: (catalog_path.parent / item["file"]).resolve()
        for item in payload["candidates"]
    }


VOICE_FILES = load_voice_files()


class SpeechRequest(BaseModel):
    model: str = "chatterbox-multilingual-v3"
    input: str = Field(min_length=1, max_length=500)
    voice: str = "narrator-female"
    language: str = "it"
    response_format: str = "wav"
    seed: int = 0
    exaggeration: float = Field(default=0.45, ge=0.25, le=1.2)
    cfg_weight: float = Field(default=0.45, ge=0.0, le=1.0)
    temperature: float = Field(default=0.7, ge=0.05, le=1.5)


app = FastAPI(title="Storyloom Chatterbox V3")
model: ChatterboxMultilingualTTS | None = None
generation_lock = asyncio.Lock()


def get_model() -> ChatterboxMultilingualTTS:
    global model
    if model is None:
        # Upstream compares this value to string literals before creating a torch.device.
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
    return model


@app.on_event("startup")
async def load_model() -> None:
    await asyncio.to_thread(get_model)


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ready": model is not None, "model": "chatterbox-multilingual-v3", "voices": list(VOICE_FILES)}


@app.post("/v1/audio/speech")
async def speech(request: SpeechRequest) -> Response:
    reference = VOICE_FILES.get(request.voice)
    if not reference:
        raise HTTPException(status_code=400, detail=f"Unknown Chatterbox voice {request.voice}")
    if not reference.is_file():
        raise HTTPException(status_code=500, detail=f"Missing Chatterbox reference {reference.name}")

    def generate() -> tuple[np.ndarray, int]:
        torch.manual_seed(request.seed)
        random.seed(request.seed)
        np.random.seed(request.seed % (2**32 - 1))
        current = get_model()
        waveform = current.generate(
            request.input,
            language_id="it",
            audio_prompt_path=str(reference),
            exaggeration=request.exaggeration,
            cfg_weight=request.cfg_weight,
            temperature=request.temperature,
        )
        return waveform.squeeze().detach().cpu().numpy(), current.sr

    async with generation_lock:
        try:
            waveform, sample_rate = await asyncio.to_thread(generate)
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Chatterbox generation failed: {error}") from error

    buffer = io.BytesIO()
    sf.write(buffer, waveform, sample_rate, format="WAV")
    return Response(buffer.getvalue(), media_type="audio/wav", headers={"x-generation-id": f"chatterbox-{request.seed}"})
