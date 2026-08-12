#!/usr/bin/env python3
"""Render a second, role-specific audition from every VoiceDesign reference."""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path


NARRATOR_TEXT = (
    "C'erano stati cinque cadaveri nel suo territorio e voleva vederci chiaro. "
    "La risposta, tuttavia, sembrava ancora molto lontana."
)
CHARACTER_TEXT = (
    "Come stai, Astri? Non preoccuparti, voglio soltanto capire che cosa è successo."
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:7861/v1")
    args = parser.parse_args()

    payload = json.loads(args.catalog.read_text(encoding="utf-8"))
    for candidate in payload["candidates"]:
        text = NARRATOR_TEXT if candidate["role"] == "narrator" else CHARACTER_TEXT
        body = json.dumps({
            "model": "chatterbox-multilingual-v3",
            "input": text,
            "voice": candidate["id"],
            "language": "it",
            "response_format": "wav",
            "seed": candidate["seed"],
            "exaggeration": 0.4,
            "cfg_weight": 0.35,
            "temperature": 0.65,
        }).encode("utf-8")
        request = urllib.request.Request(
            f"{args.base_url.rstrip('/')}/audio/speech",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )
        print(f"Rendering Chatterbox audition for {candidate['id']}", flush=True)
        with urllib.request.urlopen(request, timeout=180) as response:
            audio = response.read()
        filename = f"{candidate['id']}-chatterbox.wav"
        (args.catalog.parent / filename).write_bytes(audio)
        candidate["auditionFile"] = filename
        candidate["auditionText"] = text
        candidate["auditionControls"] = {
            "exaggeration": 0.4,
            "cfgWeight": 0.35,
            "temperature": 0.65,
        }

    args.catalog.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
