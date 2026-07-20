"""Controllable, layered RGBA smoke and dust nodes for ComfyUI."""

import math

import numpy as np
import torch
import torch.nn.functional as F


def _direction_vector(direction):
    vectors = {
        "upRight": (0.58, -0.82), "upLeft": (-0.58, -0.82),
        "right": (0.98, -0.12), "left": (-0.98, -0.12),
        "up": (0.0, -1.0), "auto": (0.35, -0.94),
    }
    dx, dy = vectors.get(direction, vectors["auto"])
    norm = math.sqrt(dx * dx + dy * dy)
    return dx / norm, dy / norm


def _noise_field(rng, width, height, cells, blur_mix=0.0):
    grid_h = max(2, int(cells * height / max(width, height)))
    grid_w = max(2, int(cells * width / max(width, height)))
    grid = torch.from_numpy(rng.random((grid_h, grid_w)).astype(np.float32))
    field = F.interpolate(grid.unsqueeze(0).unsqueeze(0), size=(height, width), mode="bicubic", align_corners=False).squeeze()
    if blur_mix > 0:
        field = (1.0 - blur_mix) * field + blur_mix * F.avg_pool2d(field.unsqueeze(0).unsqueeze(0), 5, 1, 2).squeeze()
    return field.clamp(0.0, 1.0)


def _ambient_charcoal(source, anchor_x, anchor_y):
    if source is None or not isinstance(source, torch.Tensor) or source.numel() == 0:
        return torch.tensor([0.055, 0.06, 0.07], dtype=torch.float32)
    image = source[0, ..., :3].detach().float().cpu()
    height, width = image.shape[:2]
    cx, cy = min(width - 1, max(0, int(anchor_x * width))), min(height - 1, max(0, int(anchor_y * height)))
    radius = max(8, min(width, height) // 18)
    patch = image[max(0, cy - radius):min(height, cy + radius), max(0, cx - radius):min(width, cx + radius)]
    luminance = patch.mean(dim=(0, 1)).clamp(0.0, 1.0) if patch.numel() else image.mean(dim=(0, 1)).clamp(0.0, 1.0)
    return (luminance * 0.16 + torch.tensor([0.025, 0.028, 0.035])).clamp(0.025, 0.16)


class PO_SubjectMaskResolve:
    """Use an artist mask when non-empty, otherwise use depth foreground."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"automatic_mask": ("MASK",)}, "optional": {"user_mask": ("MASK",)}}

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("subject_mask",)
    FUNCTION = "resolve"
    CATEGORY = "PixelOasis/Effects"

    def resolve(self, automatic_mask, user_mask=None):
        candidate = user_mask
        if candidate is not None and candidate.numel() > 0:
            coverage = float(candidate.detach().float().mean().cpu())
            if coverage < 0.002 or coverage > 0.985:
                candidate = None
        mask = candidate if candidate is not None else automatic_mask
        if mask.dim() == 2:
            mask = mask.unsqueeze(0)
        soft = F.avg_pool2d(mask.detach().float().clamp(0.0, 1.0).unsqueeze(1), 9, 1, 4).squeeze(1)
        return (soft.clamp(0.0, 1.0),)


class PO_FractalSmokeRGBA:
    """Generate a directionally advected, multi-scale charcoal smoke layer."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "width": ("INT", {"default": 2048, "min": 64, "max": 4096, "step": 64}),
            "height": ("INT", {"default": 2048, "min": 64, "max": 4096, "step": 64}),
            "anchor_x": ("FLOAT", {"default": 0.58, "min": 0.0, "max": 1.0, "step": 0.01}),
            "anchor_y": ("FLOAT", {"default": 0.72, "min": 0.0, "max": 1.0, "step": 0.01}),
            "direction": (["upRight", "upLeft", "right", "left", "up", "auto"], {"default": "upRight"}),
            "density": ("FLOAT", {"default": 0.42, "min": 0.05, "max": 1.0, "step": 0.01}),
            "spread": ("FLOAT", {"default": 0.42, "min": 0.10, "max": 1.0, "step": 0.01}),
            "turbulence": ("FLOAT", {"default": 0.62, "min": 0.0, "max": 1.0, "step": 0.01}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffff}),
        }, "optional": {"source": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("rgba", "alpha")
    FUNCTION = "generate"
    CATEGORY = "PixelOasis/Effects"

    def generate(self, width, height, anchor_x, anchor_y, direction, density, spread, turbulence, seed, source=None):
        with torch.inference_mode():
            rng = np.random.RandomState(seed)
            dx, dy = _direction_vector(direction)
            y, x = torch.meshgrid(torch.linspace(0.0, 1.0, height), torch.linspace(0.0, 1.0, width), indexing="ij")
            large, medium, fine = _noise_field(rng, width, height, 5, 0.5), _noise_field(rng, width, height, 15), _noise_field(rng, width, height, 42)
            rel_x = x + (medium - 0.5) * turbulence * 0.16 + (fine - 0.5) * turbulence * 0.035 - anchor_x
            rel_y = y + (large - 0.5) * turbulence * 0.10 + (medium - 0.5) * turbulence * 0.055 - anchor_y
            longitudinal, lateral = rel_x * dx + rel_y * dy, rel_x * (-dy) + rel_y * dx
            forward = torch.sigmoid((longitudinal + 0.025) * 38.0)
            tail = torch.sigmoid((1.18 - longitudinal) * 7.0)
            local_width = 0.035 + spread * (0.10 + 0.34 * longitudinal.clamp(0.0, 1.0))
            body = torch.exp(-0.5 * (lateral / local_width.clamp_min(0.012)) ** 2) * forward * tail
            texture = (0.45 * large + 0.37 * medium + 0.18 * fine).clamp(0.0, 1.0)
            alpha = body * (0.34 + 0.86 * texture) * density
            for _ in range(11):
                along, offset = rng.uniform(0.08, 0.98), rng.normal(0.0, spread * (0.05 + 0.12 * rng.uniform()))
                wisp = torch.exp(-0.5 * ((longitudinal - along) / rng.uniform(0.08, 0.25)) ** 2)
                wisp *= torch.exp(-0.5 * ((lateral - offset) / (rng.uniform(0.025, 0.09) * (0.55 + spread))) ** 2)
                alpha = torch.maximum(alpha, wisp * density * rng.uniform(0.07, 0.20) * (0.55 + medium))
            alpha = F.avg_pool2d(alpha.unsqueeze(0).unsqueeze(0), 3, 1, 1).squeeze().clamp(0.0, min(0.72, 0.14 + density * 0.62))
            charcoal = _ambient_charcoal(source, anchor_x, anchor_y)
            rgb = charcoal.view(1, 1, 3) * (0.82 + 0.24 * large).unsqueeze(-1)
            rgba = torch.cat((rgb, alpha.unsqueeze(-1)), dim=-1).unsqueeze(0)
            return (rgba.clamp(0.0, 1.0), alpha.unsqueeze(0).unsqueeze(-1))


class PO_DustParticlesRGBA:
    """Generate soft, multi-scale, wind-driven dust rather than square pixels."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "width": ("INT", {"default": 2048, "min": 64, "max": 4096, "step": 64}),
            "height": ("INT", {"default": 2048, "min": 64, "max": 4096, "step": 64}),
            "anchor_x": ("FLOAT", {"default": 0.58, "min": 0.0, "max": 1.0, "step": 0.01}),
            "anchor_y": ("FLOAT", {"default": 0.72, "min": 0.0, "max": 1.0, "step": 0.01}),
            "direction": (["upRight", "upLeft", "right", "left", "up", "auto"], {"default": "upRight"}),
            "particleAmount": ("FLOAT", {"default": 0.38, "min": 0.0, "max": 1.0, "step": 0.01}),
            "spread": ("FLOAT", {"default": 0.42, "min": 0.10, "max": 1.0, "step": 0.01}),
            "turbulence": ("FLOAT", {"default": 0.62, "min": 0.0, "max": 1.0, "step": 0.01}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffff}),
        }, "optional": {"source": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("rgba", "alpha")
    FUNCTION = "generate"
    CATEGORY = "PixelOasis/Effects"

    def generate(self, width, height, anchor_x, anchor_y, direction, particleAmount, spread, turbulence, seed, source=None):
        with torch.inference_mode():
            rng, (dx, dy) = np.random.RandomState(seed + 7919), _direction_vector(direction)
            canvas, count, base_scale = np.zeros((height, width), dtype=np.float32), int(1200 + particleAmount * 5600), min(width, height) / 1024.0
            for _ in range(count):
                band = rng.choice((0, 1, 2), p=(0.30, 0.52, 0.18))
                along, lateral = rng.beta(1.6, 2.2) * (0.30 + spread * 0.95), rng.normal(0.0, (0.025 + 0.15 * spread) * (0.40 + rng.uniform()))
                x, y = (anchor_x + dx * along - dy * lateral) * width, (anchor_y + dy * along + dx * lateral) * height
                if band == 0: radius, opacity = rng.uniform(0.45, 1.35) * base_scale, rng.uniform(0.025, 0.10)
                elif band == 1: radius, opacity = rng.uniform(0.8, 2.9) * base_scale, rng.uniform(0.045, 0.18)
                else: radius, opacity = rng.uniform(2.0, 6.0) * base_scale, rng.uniform(0.05, 0.20)
                rx, ry, pad = max(0.75, radius * (1.0 + turbulence * rng.uniform(0.0, 1.4))), max(0.75, radius * rng.uniform(0.65, 1.05)), int(math.ceil(radius * 6))
                x0, x1, y0, y1 = max(0, int(x) - pad), min(width, int(x) + pad + 1), max(0, int(y) - pad), min(height, int(y) + pad + 1)
                if x0 >= x1 or y0 >= y1: continue
                yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
                parallel, perpendicular = (xx - x) * dx + (yy - y) * dy, (xx - x) * (-dy) + (yy - y) * dx
                stamp = np.exp(-2.35 * ((parallel / rx) ** 2 + (perpendicular / ry) ** 2)) * opacity
                canvas[y0:y1, x0:x1] = np.maximum(canvas[y0:y1, x0:x1], stamp.astype(np.float32))
            alpha = torch.from_numpy(canvas).clamp(0.0, 0.42)
            rgb = (_ambient_charcoal(source, anchor_x, anchor_y) * 1.35).view(1, 1, 3).expand(height, width, 3)
            rgba = torch.cat((rgb, alpha.unsqueeze(-1)), dim=-1).unsqueeze(0)
            return (rgba.clamp(0.0, 1.0), alpha.unsqueeze(0).unsqueeze(-1))
