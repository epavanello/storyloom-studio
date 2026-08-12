#!/usr/bin/env python3
"""Generate fictional Italian voice references for Storyloom's local voice lab.

This is an offline casting utility, not part of the chapter pipeline. It uses
Qwen3-TTS VoiceDesign to create an original reference voice, which Chatterbox
can then use as its persistent speaker identity.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx_audio.tts.generate import generate_audio
from mlx_audio.tts.utils import load_model


MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"
REFERENCE_TEXT = (
    "La luce del mattino entrava dalle finestre. Parlava con calma, scegliendo "
    "ogni parola senza fretta, come se conoscesse già la risposta."
)


@dataclass(frozen=True)
class Candidate:
    id: str
    label: str
    gender: str
    role: str
    seed: int
    prompt: str


CANDIDATES = (
    Candidate(
        id="narrator-warm-a",
        label="Narratrice calda e autorevole A",
        gender="female",
        role="narrator",
        seed=1407,
        prompt=(
            "A native Italian woman in her early forties with a warm, refined, "
            "natural contralto voice. Literary audiobook narrator, intimate and "
            "authoritative without sounding theatrical, synthetic, breathy, or "
            "like a digital assistant. Neutral Italian diction, measured pace, "
            "subtle emotional depth, close studio microphone."
        ),
    ),
    Candidate(
        id="narrator-clear-b",
        label="Narratrice limpida e sobria B",
        gender="female",
        role="narrator",
        seed=2719,
        prompt=(
            "A native Italian woman in her mid thirties with a clear, elegant, "
            "human mezzo voice. Premium literary audiobook performance, calm and "
            "observant, understated rather than dramatic, no announcer cadence, "
            "no virtual-assistant tone. Neutral Italian accent and natural breath."
        ),
    ),
    Candidate(
        id="narrator-deep-c",
        label="Narratrice profonda e cinematica C",
        gender="female",
        role="narrator",
        seed=3929,
        prompt=(
            "A native Italian mature female narrator with a rich low register and "
            "a textured, believable human timbre. Controlled cinematic intimacy, "
            "serious Nordic crime audiobook mood, precise neutral Italian diction, "
            "restrained emotion, never robotic or promotional."
        ),
    ),
    Candidate(
        id="male-sober-a",
        label="Uomo maturo sobrio A",
        gender="male",
        role="character",
        seed=4513,
        prompt=(
            "A native Italian man in his late forties with a grounded baritone, "
            "slightly weathered but warm. Intelligent and concerned, speaking like "
            "a real person in a private conversation, not a broadcaster or digital "
            "assistant. Neutral Italian diction, controlled intensity."
        ),
    ),
    Candidate(
        id="male-grave-b",
        label="Uomo maturo grave B",
        gender="male",
        role="character",
        seed=5813,
        prompt=(
            "A native Italian mature man with a deep, calm, credible voice and "
            "subtle roughness. Reserved investigator energy, emotionally contained "
            "but not flat, close-mic audiobook dialogue, natural Italian phrasing, "
            "no synthetic assistant cadence."
        ),
    ),
    Candidate(
        id="male-clear-c",
        label="Uomo adulto limpido C",
        gender="male",
        role="character",
        seed=6323,
        prompt=(
            "A native Italian man in his late thirties with a clear mid-low voice, "
            "quiet confidence, and natural conversational warmth. Premium audiobook "
            "actor, subtle concern, neutral Italian accent, realistic breath and "
            "timing, never robotic, grandiose, or announcer-like."
        ),
    ),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--only", action="append", choices=[item.id for item in CANDIDATES])
    args = parser.parse_args()

    selected = [item for item in CANDIDATES if not args.only or item.id in args.only]
    args.output.mkdir(parents=True, exist_ok=True)
    model = load_model(MODEL)

    catalog = []
    for candidate in selected:
        mx.random.seed(candidate.seed)
        np.random.seed(candidate.seed)
        destination = args.output / candidate.id
        print(f"Generating {candidate.id}: {candidate.label}", flush=True)
        generate_audio(
            text=REFERENCE_TEXT,
            model=model,
            instruct=candidate.prompt,
            # Qwen's codec_language_id uses full names ("italian"), not ISO "it".
            # Passing "it" silently omits language conditioning and can produce
            # an otherwise Italian sentence with an English accent.
            lang_code="Italian",
            temperature=0.65,
            top_p=0.9,
            top_k=40,
            repetition_penalty=1.08,
            output_path=str(args.output),
            file_prefix=candidate.id,
            audio_format="wav",
            join_audio=True,
            verbose=True,
        )
        catalog.append({
            **asdict(candidate),
            "file": f"{destination.name}.wav",
            "sourceModel": MODEL,
            "language": "Italian",
            "referenceText": REFERENCE_TEXT,
            "fictionalSyntheticVoice": True,
        })

    (args.output / "catalog.json").write_text(
        json.dumps({"schemaVersion": 1, "candidates": catalog}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
