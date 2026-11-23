# -*- coding: utf-8 -*-
"""Fit Image to Size 🐈‍⬛ — crop or pad an image onto an exact target canvas.

The target size is computed from an aspect ratio + megapixel target, with an
Auto mode that takes the ratio from the input image. The image is scaled by a
single uniform factor (crop or pad, never stretch) and the outputs report the
size actually produced. Resizing uses ComfyUI's own common_upscale lanczos path.

Internal API boundary: comfy.utils.common_upscale is a ComfyUI core helper
rather than a public V3 API; re-test this node on major core upgrades.
"""

import math

import torch
import comfy.utils
from comfy_api.latest import io


AUTO = "Auto (from image)"
CROP = "crop"
PAD = "pad"
PAD_FILL = 0.0
AUTO_CROP_TOLERANCE = 0.02

ASPECT_RATIOS = {
    "1:1 (Square)": (1, 1),
    "2:3 (Portrait Photo)": (2, 3),
    "3:2 (Photo)": (3, 2),
    "3:4 (Portrait Standard)": (3, 4),
    "4:3 (Standard)": (4, 3),
    "9:16 (Portrait Widescreen)": (9, 16),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}


def _ratio_drift(src_w, src_h, width, height):
    if min(src_w, src_h, width, height) <= 0:
        return 0.0
    return abs((width / height) / (src_w / src_h) - 1.0)


def _target_size(ratio_w, ratio_h, megapixels, multiple):
    step = max(1, int(multiple))
    scale = math.sqrt(max(0.0, float(megapixels)) * 1024 * 1024 / (ratio_w * ratio_h))
    width = round(ratio_w * scale / step) * step
    height = round(ratio_h * scale / step) * step
    return max(step, width), max(step, height)


def _image_size(image):
    if image.dim() == 4:
        return int(image.shape[2]), int(image.shape[1])
    return int(image.shape[1]), int(image.shape[0])


def _fit(image, width, height, mode):
    samples = image if image.dim() == 4 else image.unsqueeze(0)
    samples = samples.movedim(-1, 1)
    batch, channels, src_h, src_w = samples.shape

    if src_w == width and src_h == height:
        return samples.movedim(1, -1)

    if mode == PAD:
        scale = min(width / src_w, height / src_h)
        inner_w = max(1, min(width, int(round(src_w * scale))))
        inner_h = max(1, min(height, int(round(src_h * scale))))
        inner = comfy.utils.common_upscale(samples, inner_w, inner_h, "lanczos", "disabled")
        canvas = torch.full(
            (batch, channels, height, width),
            float(PAD_FILL),
            dtype=inner.dtype,
            device=inner.device,
        )
        top = (height - inner_h) // 2
        left = (width - inner_w) // 2
        canvas[:, :, top:top + inner_h, left:left + inner_w] = inner
        return canvas.movedim(1, -1)

    return comfy.utils.common_upscale(samples, width, height, "lanczos", "center").movedim(1, -1)


class CatFitImageToSize(io.ComfyNode):
    """Fit an image onto a computed canvas without stretching it."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛CatFitImageToSize",
            display_name="Fit Image to Size 🐈‍⬛",
            category="🐈‍⬛CatNodes/image",
            search_aliases=[
                "fit", "resize", "crop", "pad", "letterbox", "aspect ratio",
                "cover", "contain", "canvas", "megapixel", "resolution", "catnodes",
            ],
            description=(
                "Compute a target size from aspect ratio + megapixels, then scale the image "
                "onto it with one uniform factor. "
                "'Auto' uses the image's own ratio. A closely matching target is centre-cropped; "
                "a distant one is padded with black. Outputs the image, width, height and the "
                "equivalent square edge round(sqrt(width*height))."
            ),
            inputs=[
                io.Image.Input("image", tooltip="Image to fit."),
                io.Combo.Input(
                    "aspect_ratio",
                    options=[AUTO, *ASPECT_RATIOS],
                    default=AUTO,
                    tooltip="Target ratio; 'Auto' uses the input image's own ratio.",
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.01,
                    max=16.0,
                    step=0.01,
                    tooltip="Target megapixels; 1.0 gives 1024x1024 for a square ratio.",
                ),
                io.ResolutionPreview.Input(
                    "preview",
                    ratio_widget="preview_ratio",
                    megapixels_widget="preview_megapixels",
                    multiple_widget="multiple",
                    tooltip="Live preview of the target size.",
                ),
                io.Int.Input(
                    "multiple",
                    default=32,
                    min=1,
                    max=256,
                    step=1,
                    advanced=True,
                    tooltip="Snap the size to this grid; 1 keeps the raw result.",
                ),
                io.String.Input(
                    "preview_ratio",
                    default="1:1",
                    optional=True,
                    socketless=True,
                    tooltip="Internal feed for the resolution preview.",
                ),
                io.Float.Input(
                    "preview_megapixels",
                    default=1.0,
                    min=0.0,
                    max=1024.0,
                    step=0.000001,
                    optional=True,
                    socketless=True,
                    tooltip="Internal feed for the resolution preview.",
                ),
            ],
            outputs=[
                io.Image.Output("image", tooltip="Image scaled onto the computed canvas."),
                io.Int.Output("out_width", display_name="width", tooltip="Width actually produced."),
                io.Int.Output("out_height", display_name="height", tooltip="Height actually produced."),
                io.Int.Output(
                    "out_resolution",
                    display_name="resolution",
                    tooltip="Equivalent square edge, round(sqrt(width*height)).",
                ),
            ],
        )

    @classmethod
    def validate_inputs(cls, image=None, aspect_ratio=AUTO, **kwargs):
        if aspect_ratio != AUTO and aspect_ratio not in ASPECT_RATIOS:
            return f"Unknown aspect ratio: {aspect_ratio}"
        return True

    @classmethod
    def execute(
        cls,
        image,
        aspect_ratio,
        megapixels=1.0,
        multiple=32,
        preview=None,
        preview_ratio=None,
        preview_megapixels=None,
    ):
        src_w, src_h = _image_size(image)
        if aspect_ratio == AUTO:
            ratio_w, ratio_h = src_w, src_h
        else:
            ratio_w, ratio_h = ASPECT_RATIOS[aspect_ratio]

        width, height = _target_size(ratio_w, ratio_h, megapixels, multiple)
        close = aspect_ratio == AUTO or _ratio_drift(src_w, src_h, width, height) <= AUTO_CROP_TOLERANCE
        fitted = _fit(image, width, height, CROP if close else PAD)
        return io.NodeOutput(fitted, width, height, int(round(math.sqrt(width * height))))
