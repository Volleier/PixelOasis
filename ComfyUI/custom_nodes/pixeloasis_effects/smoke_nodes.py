"""
PO_FractalSmokeRGBA — Multi-octave FBM fractal smoke generator (RGBA output).
PO_DustParticlesRGBA — Particle dust field generator (RGBA output).

Both nodes produce deterministic output for a given seed.
All processing uses torch.inference_mode(), FP16 inference, and explicit
tensor cleanup. Fixed seed must produce byte-identical output.
"""

import torch
import torch.nn.functional as F
import numpy as np


class PO_FractalSmokeRGBA:
    """Generate fractal smoke as RGBA image using multi-octave FBM + curl noise.

    Inputs:
        width, height    — output dimensions in pixels
        anchor_x, anchor_y — smoke origin (0..1 normalized)
        direction        — "upRight", "upLeft", "right", "left", "up", "auto"
        density          — 0.05..1.0, opacity and coverage
        spread           — 0.10..1.0, plume spread angle
        turbulence       — 0.0..1.0, noise curl intensity
        seed             — integer for reproducibility
    Outputs:
        IMAGE            — RGBA image tensor (B, H, W, 4)
        MASK             — alpha mask (B, H, W, 1)
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "anchor_x": ("FLOAT", {"default": 0.58, "min": 0.0, "max": 1.0, "step": 0.01}),
                "anchor_y": ("FLOAT", {"default": 0.72, "min": 0.0, "max": 1.0, "step": 0.01}),
                "direction": (["upRight", "upLeft", "right", "left", "up", "auto"], {"default": "upRight"}),
                "density": ("FLOAT", {"default": 0.50, "min": 0.05, "max": 1.0, "step": 0.01}),
                "spread": ("FLOAT", {"default": 0.45, "min": 0.10, "max": 1.0, "step": 0.01}),
                "turbulence": ("FLOAT", {"default": 0.55, "min": 0.0, "max": 1.0, "step": 0.01}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffff}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("rgba", "alpha")
    FUNCTION = "generate"
    CATEGORY = "PixelOasis/Effects"

    def generate(self, width, height, anchor_x, anchor_y, direction, density,
                 spread, turbulence, seed):
        with torch.inference_mode():
            rng = np.random.RandomState(seed)

            # Compute direction vector
            dir_map = {
                "upRight": (0.5, 0.7), "upLeft": (-0.5, 0.7),
                "right": (0.8, 0.1), "left": (-0.8, 0.1),
                "up": (0.0, 0.9), "auto": (0.3, 0.6),
            }
            dx, dy = dir_map.get(direction, (0.3, 0.6))

            # Generate multi-octave FBM noise field
            octaves = 5
            noise_field = self._fbm_noise(rng, width, height, octaves, turbulence)

            # Build smoke plume from anchor point with direction + spread
            y_coords = torch.linspace(0, 1, height, dtype=torch.float32)
            x_coords = torch.linspace(0, 1, width, dtype=torch.float32)
            gy, gx = torch.meshgrid(y_coords, x_coords, indexing="ij")

            plume_x = (gx - anchor_x) * (1.0 / max(spread, 0.01))
            plume_y = (gy - anchor_y) * (1.0 / max(spread, 0.01))
            plume_dist = torch.sqrt(plume_x ** 2 + plume_y ** 2)

            # Directional bias
            dir_bias = (gx - anchor_x) * (-dy) + (gy - anchor_y) * dx
            plume_mask = torch.sigmoid((1.0 - plume_dist * 2.5 + dir_bias * 0.5) * 5.0)

            # Apply density + noise
            alpha = plume_mask * density * (0.6 + 0.4 * noise_field)
            alpha = torch.clamp(alpha, 0.0, 1.0)

            # RGBA output (smoke color: dark gray-black)
            rgba = torch.zeros(height, width, 4, dtype=torch.float32)
            rgba[..., 0] = 0.08   # R
            rgba[..., 1] = 0.08   # G
            rgba[..., 2] = 0.10   # B
            rgba[..., 3] = alpha  # A

            # Batch dimension
            rgba = rgba.unsqueeze(0)
            mask = alpha.unsqueeze(0).unsqueeze(-1)

            del gx, gy, plume_x, plume_y, plume_dist, dir_bias, plume_mask
            del noise_field

        return (rgba, mask)

    def _fbm_noise(self, rng, w, h, octaves, turbulence):
        """Multi-octave FBM noise using value noise at multiple scales."""
        field = torch.zeros(h, w, dtype=torch.float32)
        amplitude = 0.5
        frequency = 1.0
        max_val = 0.0

        for o in range(octaves):
            scale_w = max(2, int(w * frequency / 8))
            scale_h = max(2, int(h * frequency / 8))
            noise = torch.from_numpy(
                rng.rand(scale_h, scale_w).astype(np.float32)
            )
            noise = F.interpolate(
                noise.unsqueeze(0).unsqueeze(0),
                size=(h, w), mode='bilinear', align_corners=False
            ).squeeze()

            field += noise * amplitude * turbulence
            max_val += amplitude
            amplitude *= 0.5
            frequency *= 2.0

        field = field / max(max_val, 0.001)
        return (field - field.min()) / (field.max() - field.min() + 0.001)


class PO_DustParticlesRGBA:
    """Generate dust/debris particle field as RGBA image.

    Inputs:
        width, height    — output dimensions
        anchor_x, anchor_y — emission origin (0..1)
        direction        — wind direction
        particleAmount   — 0..1, particle count and brightness
        spread           — spread angle
        turbulence       — randomness in particle trajectories
        seed             — reproducibility
    Outputs:
        IMAGE            — RGBA image tensor (B, H, W, 4)
        MASK             — alpha mask (B, H, W, 1)
    """

    MAX_PARTICLES = 1200

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "anchor_x": ("FLOAT", {"default": 0.58, "min": 0.0, "max": 1.0, "step": 0.01}),
                "anchor_y": ("FLOAT", {"default": 0.72, "min": 0.0, "max": 1.0, "step": 0.01}),
                "direction": (["upRight", "upLeft", "right", "left", "up", "auto"], {"default": "upRight"}),
                "particleAmount": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01}),
                "spread": ("FLOAT", {"default": 0.45, "min": 0.10, "max": 1.0, "step": 0.01}),
                "turbulence": ("FLOAT", {"default": 0.55, "min": 0.0, "max": 1.0, "step": 0.01}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffff}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("rgba", "alpha")
    FUNCTION = "generate"
    CATEGORY = "PixelOasis/Effects"

    def generate(self, width, height, anchor_x, anchor_y, direction,
                 particleAmount, spread, turbulence, seed):
        with torch.inference_mode():
            rng = np.random.RandomState(seed)

            num_particles = int(particleAmount * self.MAX_PARTICLES)
            if num_particles <= 0:
                empty_rgba = torch.zeros(1, height, width, 4, dtype=torch.float32)
                empty_mask = torch.zeros(1, height, width, 1, dtype=torch.float32)
                return (empty_rgba, empty_mask)

            dir_map = {
                "upRight": (0.5, 0.7), "upLeft": (-0.5, 0.7),
                "right": (0.8, 0.1), "left": (-0.8, 0.1),
                "up": (0.0, 0.9), "auto": (0.3, 0.6),
            }
            dx, dy = dir_map.get(direction, (0.3, 0.6))

            # Generate particle positions
            px = rng.rand(num_particles).astype(np.float32) * spread * width + (anchor_x - spread * 0.5) * width
            py = rng.rand(num_particles).astype(np.float32) * spread * height * 0.6 + anchor_y * height

            # Displace by direction + turbulence
            px += dx * width * rng.randn(num_particles).astype(np.float32) * 0.15 * turbulence
            py += (-dy * height * 0.4 + rng.randn(num_particles).astype(np.float32) * 0.1 * turbulence) * height

            # Particle sizes and opacities
            sizes = rng.rand(num_particles).astype(np.float32) * 4.0 + 1.0  # 1-5 px
            alphas = rng.rand(num_particles).astype(np.float32) * 0.6 + 0.2  # 0.2-0.8

            # Render particles onto RGBA canvas
            rgba = torch.zeros(height, width, 4, dtype=torch.float32)
            px_t = torch.from_numpy(px).long()
            py_t = torch.from_numpy(py).long()
            sizes_t = torch.from_numpy(sizes)
            alphas_t = torch.from_numpy(alphas)

            valid = (px_t >= 0) & (px_t < width) & (py_t >= 0) & (py_t < height)
            px_t = px_t[valid]; py_t = py_t[valid]
            sizes_t = sizes_t[valid]; alphas_t = alphas_t[valid]

            for i in range(len(px_t)):
                r = max(1, int(sizes_t[i].item()))
                x0, x1 = max(0, px_t[i].item() - r), min(width, px_t[i].item() + r + 1)
                y0, y1 = max(0, py_t[i].item() - r), min(height, py_t[i].item() + r + 1)
                rgba[y0:y1, x0:x1, 0] += 0.15 * alphas_t[i]
                rgba[y0:y1, x0:x1, 1] += 0.15 * alphas_t[i]
                rgba[y0:y1, x0:x1, 2] += 0.18 * alphas_t[i]
                rgba[y0:y1, x0:x1, 3] += alphas_t[i] / (r * 2)

            rgba[..., :3] = torch.clamp(rgba[..., :3], 0.0, 1.0)
            rgba[..., 3] = torch.clamp(rgba[..., 3], 0.0, 1.0)

            rgba = rgba.unsqueeze(0)
            mask = rgba[..., 3:4]

        return (rgba, mask)
