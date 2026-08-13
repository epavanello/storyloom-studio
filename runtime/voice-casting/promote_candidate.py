#!/usr/bin/env python3
"""Promote one diagnostic reference into the active catalog without losing metadata."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--voice", required=True)
    args = parser.parse_args()

    source = json.loads(args.source.read_text(encoding="utf-8"))
    destination = json.loads(args.destination.read_text(encoding="utf-8"))
    promoted = next(item for item in source["candidates"] if item["id"] == args.voice)
    promoted.pop("auditionFile", None)
    promoted.pop("auditionText", None)
    promoted.pop("auditionControls", None)
    index = next(index for index, item in enumerate(destination["candidates"]) if item["id"] == args.voice)
    destination["candidates"][index] = promoted
    shutil.copy2(args.source.parent / promoted["file"], args.destination.parent / promoted["file"])
    args.destination.write_text(
        json.dumps(destination, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
