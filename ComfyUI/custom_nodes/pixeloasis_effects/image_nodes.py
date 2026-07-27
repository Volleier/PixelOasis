"""RGBA compositing and transparent artifact output nodes."""

import os

import folder_paths
import numpy as np
import torch
from PIL import Image


class PO_RGBAComposite:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {"source": ("IMAGE",), "back": ("IMAGE",), "front": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("composite",)
    FUNCTION = "composite"
    CATEGORY = "PixelOasis/Effects"

    def composite(self, source, back, front):
        with torch.inference_mode():
            _, height, width, _ = source.shape
            if back.shape[1] != height or back.shape[2] != width:
                back = torch.nn.functional.interpolate(
                    back.permute(0, 3, 1, 2), size=(height, width), mode="bilinear", align_corners=False
                ).permute(0, 2, 3, 1)
            if front.shape[1] != height or front.shape[2] != width:
                front = torch.nn.functional.interpolate(
                    front.permute(0, 3, 1, 2), size=(height, width), mode="bilinear", align_corners=False
                ).permute(0, 2, 3, 1)
            back_alpha = back[..., 3:4]
            result = back[..., :3] * back_alpha + source[..., :3] * (1.0 - back_alpha)
            front_alpha = front[..., 3:4]
            result = front[..., :3] * front_alpha + result * (1.0 - front_alpha)
        return (torch.clamp(result, 0.0, 1.0),)


class PO_MergeRGBA:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {"back": ("IMAGE",), "front": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("rgba",)
    FUNCTION = "merge"
    CATEGORY = "PixelOasis/Effects"

    def merge(self, back, front):
        with torch.inference_mode():
            if back.shape != front.shape:
                front = torch.nn.functional.interpolate(
                    front.permute(0, 3, 1, 2), size=back.shape[1:3], mode="bilinear", align_corners=False
                ).permute(0, 2, 3, 1)
            back_alpha = back[..., 3:4]
            front_alpha = front[..., 3:4]
            alpha = front_alpha + back_alpha * (1.0 - front_alpha)
            rgb = front[..., :3] * front_alpha + back[..., :3] * back_alpha * (1.0 - front_alpha)
            rgb = torch.where(alpha > 1e-6, rgb / alpha.clamp_min(1e-6), torch.zeros_like(rgb))
        return (torch.cat((rgb.clamp(0.0, 1.0), alpha.clamp(0.0, 1.0)), dim=-1),)


class PO_SaveLayeredImage:
    """Save an RGBA artifact without discarding its alpha channel."""

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "PixelOasis"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    CATEGORY = "PixelOasis/Effects"
    OUTPUT_NODE = True

    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.compress_level = 4

    def save_images(self, images, filename_prefix="PixelOasis", prompt=None, extra_pnginfo=None):
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0]
        )
        results = []
        for batch_number, image in enumerate(images):
            pixels = np.clip(255.0 * image.detach().cpu().numpy(), 0, 255).astype(np.uint8)
            if pixels.shape[-1] != 4:
                raise RuntimeError("PO_SaveLayeredImage requires an RGBA image")
            output_filename = f"{filename.replace('%batch_num%', str(batch_number))}_{counter:05}_.png"
            Image.fromarray(pixels, mode="RGBA").save(
                os.path.join(full_output_folder, output_filename), compress_level=self.compress_level
            )
            results.append({"filename": output_filename, "subfolder": subfolder, "type": self.type})
            counter += 1
        return {"ui": {"images": results}}
