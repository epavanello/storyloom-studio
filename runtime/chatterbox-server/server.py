import asyncio
import io
import json
import os
import random
import re
from collections.abc import Iterable
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


VOICE_DIR = Path(os.environ["CHATTERBOX_VOICE_DIR"]).resolve()

# Transport ceiling only: long enough for any passage a chapter plan can produce,
# low enough that a whole pasted book is still rejected rather than queued.
MAX_INPUT_CHARS = 20_000
# The real bound. Chatterbox drifts and then truncates well before a long paragraph
# is finished, so anything above this is synthesized as several stitched generations.
MAX_CHUNK_CHARS = 400
# Breath between stitched pieces, so a forced split does not read as a hard cut.
CHUNK_GAP_SECONDS = 0.18

_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?…])\s+|\n+")
_CLAUSE_BOUNDARY = re.compile(r"(?<=[,;:])\s+|\s+[—–]\s+")


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


def _pack(parts: Iterable[str], limit: int) -> list[str]:
    """Greedily rejoins adjacent parts while they still fit under the limit."""
    packed: list[str] = []
    for part in (candidate.strip() for candidate in parts):
        if not part:
            continue
        if packed and len(packed[-1]) + 1 + len(part) <= limit:
            packed[-1] = f"{packed[-1]} {part}"
        else:
            packed.append(part)
    return packed


def _split_forced(text: str, limit: int) -> list[str]:
    """Last resort: break on whitespace, and mid-word if a single word is too long.

    Nothing below this can fail, which is the point — an unbroken run of characters
    must never be able to stall a request the caller has no way to shorten.
    """
    chunks: list[str] = []
    current = ""
    for word in text.split():
        while len(word) > limit:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(word[:limit])
            word = word[limit:]
        candidate = f"{current} {word}".strip()
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            chunks.append(current)
        current = word
    if current:
        chunks.append(current)
    return chunks


def split_for_synthesis(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    """Breaks text into pieces one generation can carry without degrading.

    Sentence boundaries are preferred, then clause boundaries, then whitespace, so a
    passage is only ever cut where a reader would already pause.
    """
    chunks: list[str] = []
    for sentence in _pack(_SENTENCE_BOUNDARY.split(text), limit):
        if len(sentence) <= limit:
            chunks.append(sentence)
            continue
        for clause in _pack(_CLAUSE_BOUNDARY.split(sentence), limit):
            if len(clause) <= limit:
                chunks.append(clause)
            else:
                chunks.extend(_split_forced(clause, limit))
    return chunks


class SpeechRequest(BaseModel):
    model: str = "chatterbox-multilingual-v3"
    input: str = Field(min_length=1, max_length=MAX_INPUT_CHARS)
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
    return {
        "ready": model is not None,
        "model": "chatterbox-multilingual-v3",
        "voices": list(VOICE_FILES),
        "maxInputChars": MAX_INPUT_CHARS,
        "maxChunkChars": MAX_CHUNK_CHARS,
    }


@app.post("/v1/audio/speech")
async def speech(request: SpeechRequest) -> Response:
    reference = VOICE_FILES.get(request.voice)
    if not reference:
        raise HTTPException(status_code=400, detail=f"Unknown Chatterbox voice {request.voice}")
    if not reference.is_file():
        raise HTTPException(status_code=500, detail=f"Missing Chatterbox reference {reference.name}")

    chunks = split_for_synthesis(request.input)
    if not chunks:
        raise HTTPException(status_code=400, detail="The input contains no pronounceable text")

    def generate() -> tuple[np.ndarray, int]:
        random.seed(request.seed)
        np.random.seed(request.seed % (2**32 - 1))
        current = get_model()
        segments: list[np.ndarray] = []
        for chunk in chunks:
            # Reseeded per chunk so a split the caller never asked for cannot make the
            # timbre drift halfway through a single passage.
            torch.manual_seed(request.seed)
            waveform = current.generate(
                chunk,
                language_id="it",
                audio_prompt_path=str(reference),
                exaggeration=request.exaggeration,
                cfg_weight=request.cfg_weight,
                temperature=request.temperature,
            )
            segments.append(waveform.squeeze().detach().cpu().numpy())
        if len(segments) == 1:
            return segments[0], current.sr
        gap = np.zeros(int(current.sr * CHUNK_GAP_SECONDS), dtype=segments[0].dtype)
        stitched: list[np.ndarray] = []
        for segment in segments:
            stitched.extend((segment, gap))
        return np.concatenate(stitched[:-1]), current.sr

    async with generation_lock:
        try:
            waveform, sample_rate = await asyncio.to_thread(generate)
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Chatterbox generation failed: {error}") from error

    buffer = io.BytesIO()
    sf.write(buffer, waveform, sample_rate, format="WAV")
    return Response(
        buffer.getvalue(),
        media_type="audio/wav",
        headers={"x-generation-id": f"chatterbox-{request.seed}", "x-chunk-count": str(len(chunks))},
    )
