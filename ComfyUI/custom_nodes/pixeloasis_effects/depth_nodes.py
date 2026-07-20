"""Depth Anything V2 Large inference and RGBA depth splitting."""

from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from safetensors.torch import load_file
from depth_anything_v2.dpt import DepthAnythingV2


MODEL_FILENAME = "depth_anything_v2_vitl_fp16.safetensors"
MODEL_DIR = Path(__file__).resolve().parents[3] / "models" / "depthanything"


def _model_path():
    configured = Path(__import__("os").environ.get("PO_DEPTH_ANYTHING_MODEL", ""))
    if configured.is_file():
        return configured
    try:
        import folder_paths
        shared_path = Path(folder_paths.models_dir) / "depthanything" / MODEL_FILENAME
        if shared_path.is_file():
            return shared_path
    except ImportError:
        pass
    return MODEL_DIR / MODEL_FILENAME


class PO_DepthEstimate:
    """Load Depth Anything V2 Large and estimate a normalized depth map.

    Inputs:
        IMAGE          — source image (B, H, W, 3)
    Outputs:
        DEPTH          — normalized depth map (B, H, W, 1), 0=near, 1=far
        MASK           — foreground confidence mask (B, H, W, 1)
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "max_side": ("INT", {"default": 2048, "min": 512, "max": 4096, "step": 64}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("depth", "foreground_mask")
    FUNCTION = "estimate"
    CATEGORY = "PixelOasis/Effects"

    def __init__(self):
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def _load_model(self):
        if self.model is not None:
            return self.model

        checkpoint_path = _model_path()
        if not checkpoint_path.is_file():
            raise RuntimeError("Depth Anything V2 Large model is missing: " + str(checkpoint_path))

        model = DepthAnythingV2(
            encoder="vitl",
            features=256,
            out_channels=[256, 512, 1024, 1024],
        )
        state_dict = load_file(str(checkpoint_path), device="cpu")
        missing, unexpected = model.load_state_dict(state_dict, strict=False)
        if missing or unexpected:
            raise RuntimeError(
                "Depth Anything V2 Large checkpoint is incompatible "
                "(missing=%d, unexpected=%d)" % (len(missing), len(unexpected))
            )
        self.model = model.eval().to(self.device)
        return self.model

    def estimate(self, image, max_side=2048):
        with torch.inference_mode():
            model = self._load_model()
            depth_maps = []
            for sample in image:
                rgb_tensor = sample[..., :3].detach().float().cpu()
                source_height, source_width = rgb_tensor.shape[:2]
                scale = min(1.0, float(max_side) / max(source_width, source_height))
                target_width = max(1, round(source_width * scale))
                target_height = max(1, round(source_height * scale))
                if (target_width, target_height) != (source_width, source_height):
                    rgb_tensor = F.interpolate(
                        rgb_tensor.permute(2, 0, 1).unsqueeze(0),
                        size=(target_height, target_width),
                        mode="bicubic",
                        align_corners=False,
                    ).squeeze(0).permute(1, 2, 0)
                rgb = rgb_tensor.numpy()
                bgr = np.ascontiguousarray(np.clip(rgb[..., ::-1] * 255.0, 0, 255).astype(np.uint8))
                depth = model.infer_image(bgr, input_size=756)
                depth = torch.from_numpy(depth).to(dtype=torch.float32)
                depth = (depth - depth.amin()) / (depth.amax() - depth.amin() + 1e-6)
                depth_maps.append(depth)

            depth = torch.stack(depth_maps, dim=0).unsqueeze(-1).to(image.device)
            fg_mask = (depth[..., 0] < 0.5).to(dtype=torch.float32)

        return (depth, fg_mask)


class PO_DepthSplitRGBA:
    """Split an RGBA layer into back and front using depth + subject mask.

    Inputs:
        rgba           — RGBA layer to split (from PO_FractalSmokeRGBA / PO_DustParticlesRGBA)
        depth          — depth map from PO_DepthEstimate
        subject_mask   — (optional) binary subject mask
        occlusion      — "auto", "back", or "front"

    Outputs:
        back           — RGBA for behind-subject portion
        front          — RGBA for in-front-of-subject portion

    Rules:
        - occlusion=back: all rgba goes to back (front=transparent)
        - occlusion=front: all rgba goes to front (back=transparent)
        - occlusion=auto: split by depth + subject — near=front, far=back
        - No subject_mask + auto: front is fully transparent
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "rgba": ("IMAGE",),
                "depth": ("IMAGE",),
                "occlusion": (["auto", "back", "front"], {"default": "auto"}),
            },
            "optional": {
                "subject_mask": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("back", "front")
    FUNCTION = "split"
    CATEGORY = "PixelOasis/Effects"

    def split(self, rgba, depth, occlusion, subject_mask=None):
        with torch.inference_mode():
            batch, h, w, c = rgba.shape
            device = rgba.device

            back = rgba.clone()
            front = torch.zeros_like(rgba)

            if occlusion == "back":
                return (back, front)
            elif occlusion == "front":
                return (front, back)

            # auto: split by depth
            if subject_mask is not None and subject_mask.numel() > 0:
                if subject_mask.dim() == 3:
                    subject_mask = subject_mask.unsqueeze(-1)

                # Resize subject mask if needed
                if subject_mask.shape[1] != h or subject_mask.shape[2] != w:
                    subject_mask = F.interpolate(
                        subject_mask.permute(0, 3, 1, 2),
                        size=(h, w), mode='bilinear', align_corners=False
                    ).permute(0, 2, 3, 1)

                # Near subject = front, far from subject = back
                depth_norm = depth if depth.dim() == 4 else depth.unsqueeze(-1)
                if depth_norm.shape[1] != h or depth_norm.shape[2] != w:
                    depth_norm = F.interpolate(
                        depth_norm.permute(0, 3, 1, 2),
                        size=(h, w), mode='bilinear', align_corners=False
                    ).permute(0, 2, 3, 1)

                near_mask = (depth_norm < 0.5).float()
                subject_near = subject_mask * near_mask
                subject_near = subject_near.expand(-1, -1, -1, c)

                front = rgba * subject_near
                back = rgba * (1.0 - subject_near)

        return (back, front)
