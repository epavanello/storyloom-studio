"""Storyloom compatibility additions for mlx-openai-server.

mlx-openai-server 1.8.1 already forwards width and height to MFLUX, but its
OpenAI-compatible request schema only accepts square presets. Python imports
``sitecustomize`` automatically at startup, so keeping this small overlay on
``PYTHONPATH`` lets Storyloom request a native 16:9 frame without modifying the
installed virtual environment.
"""

import asyncio
import os
import uuid
from enum import StrEnum
from typing import Any

from app.core.handler_process import HandlerProcessProxy
from app.schemas import openai as schemas
from app.handler.mflux import MLXFluxHandler


class StoryloomImageSize(StrEnum):
    SMALL = "256x256"
    MEDIUM = "512x512"
    LARGE = "1024x1024"
    WIDE = "1024x576"


def _replace_size_field(model: type, default: StoryloomImageSize | None) -> None:
    annotation = StoryloomImageSize | None
    model.__annotations__["size"] = annotation
    field = model.model_fields["size"]
    field.annotation = annotation
    field.default = default
    model.model_rebuild(force=True)


schemas.ImageSize = StoryloomImageSize
_replace_size_field(schemas.ImageGenerationRequest, StoryloomImageSize.LARGE)
_replace_size_field(schemas.ImageEditRequest, None)


async def _proxy_wide_edit_image(
    self: HandlerProcessProxy, request: schemas.ImageEditRequest
) -> Any:
    images = request.image if isinstance(request.image, list) else [request.image]
    temp_paths: list[str] = []
    for image in images:
        temp_paths.append(await self._save_upload_file(image, suffix=".png"))

    width = height = None
    if request.size is not None:
        width, height = map(int, request.size.value.split("x"))
    edit_data = {
        "image_paths": temp_paths,
        "prompt": request.prompt,
        "negative_prompt": request.negative_prompt,
        "steps": request.steps,
        "seed": request.seed,
        "guidance_scale": request.guidance_scale,
        "width": width,
        "height": height,
    }
    try:
        return await self._call("edit_image_from_paths", edit_data)
    finally:
        for path in temp_paths:
            try:
                if os.path.exists(path):
                    os.unlink(path)
            except OSError:
                pass


async def _wide_edit_image_from_paths(
    self: MLXFluxHandler, edit_data: dict[str, Any]
) -> Any:
    request_id = f"image-edit-{uuid.uuid4()}"
    temp_file_paths = edit_data.get("image_paths", [])
    try:
        request_data = {
            "image_path": temp_file_paths[0] if temp_file_paths else None,
            "prompt": edit_data.get("prompt"),
            "negative_prompt": edit_data.get("negative_prompt"),
            "steps": edit_data.get("steps"),
            "seed": edit_data.get("seed"),
            "guidance": edit_data.get("guidance_scale"),
            "image_paths": temp_file_paths,
            "width": edit_data.get("width"),
            "height": edit_data.get("height"),
        }
        image_result = await self.inference_worker.submit(self._run_inference, request_data)
        return self._create_edit_response(image_result)
    except asyncio.QueueFull:
        self._handle_queue_full_error(request_id)
    except Exception as error:
        self._handle_edit_error(request_id, error)
    finally:
        self._cleanup_temp_files(temp_file_paths)


HandlerProcessProxy.edit_image = _proxy_wide_edit_image
MLXFluxHandler.edit_image_from_paths = _wide_edit_image_from_paths
