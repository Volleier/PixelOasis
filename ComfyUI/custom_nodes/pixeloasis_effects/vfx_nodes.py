"""Generative VFX plate compositing nodes."""

import torch
import torch.nn.functional as F


def _as_mask(mask, height, width, device):
    if mask is None or mask.numel() == 0:
        return torch.zeros((1, height, width), device=device, dtype=torch.float32)
    value = mask.detach().float().to(device)
    if value.dim() == 4:
        value = value[..., 0]
    if value.dim() == 2:
        value = value.unsqueeze(0)
    if value.shape[1:] != (height, width):
        value = F.interpolate(value.unsqueeze(1), size=(height, width), mode="bilinear", align_corners=False).squeeze(1)
    return value.clamp(0.0, 1.0)


class PO_VFXPromptBuilder:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "direction": (["upRight", "upLeft", "right", "left", "up", "auto"], {"default": "upRight"}),
            "particle_amount": ("FLOAT", {"default": 0.72, "min": 0.0, "max": 1.0, "step": 0.05}),
        }}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "build"
    CATEGORY = "PixelOasis/Effects"

    def build(self, direction, particle_amount):
        direction_text = {
            "upRight": "erupting from the lower-left and sweeping dramatically upward-right",
            "upLeft": "erupting from the lower-right and sweeping dramatically upward-left",
            "right": "blasting forcefully from left to right",
            "left": "blasting forcefully from right to left",
            "up": "erupting vertically upward with a broad mushrooming crown",
            "auto": "sweeping diagonally across most of the frame",
        }[direction]
        particle_text = "dense ochre desert sand and many visible debris particles" if particle_amount >= 0.5 else "moderate ochre sand and sparse debris particles"
        return ((
            "photorealistic Hollywood film VFX element plate, physically simulated enormous dense pitch-black smoke explosion "
            + direction_text + ", broad rolling volumetric billows with turbulent cauliflower edges, deep black core, "
            "gray translucent wisps, crisp high-frequency detail, bright warm rim-lit ochre sand and sharp rock debris, "
            + particle_text + ", large readable foreground chunks with motion streaks, strong contrast, natural atmospheric perspective, "
            "the effect fills sixty percent of the image, isolated on a perfectly uniform pure white background, "
            "no decorative curls, no ornamental patterns, no fractal illustration, no flat gray cloud, no ground plane, "
            "no horizon, no person, no objects, no text, no watermark, no frame"
        ),)


class PO_VFXPlateComposite:
    """Key a generated white-background VFX plate and composite one final image."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "source": ("IMAGE",),
            "plate": ("IMAGE",),
            "depth": ("IMAGE",),
            "subject_mask": ("MASK",),
            "effect_strength": ("FLOAT", {"default": 1.35, "min": 0.4, "max": 2.0, "step": 0.05}),
            "effect_scale": ("FLOAT", {"default": 1.05, "min": 0.65, "max": 1.5, "step": 0.05}),
            "anchor_x": ("FLOAT", {"default": 0.58, "min": 0.0, "max": 1.0, "step": 0.01}),
            "anchor_y": ("FLOAT", {"default": 0.62, "min": 0.0, "max": 1.0, "step": 0.01}),
            "white_threshold": ("FLOAT", {"default": 0.12, "min": 0.0, "max": 0.35, "step": 0.01}),
        }}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("result",)
    FUNCTION = "composite"
    CATEGORY = "PixelOasis/Effects"

    def composite(self, source, plate, depth, subject_mask, effect_strength, effect_scale, anchor_x, anchor_y, white_threshold):
        with torch.inference_mode():
            source_rgb = source[..., :3].float()
            batch, height, width, _ = source_rgb.shape
            plate_rgb = plate[..., :3].float()
            plate_chw = plate_rgb.permute(0, 3, 1, 2)
            grid_y, grid_x = torch.meshgrid(
                torch.linspace(0.0, 1.0, height, device=source_rgb.device),
                torch.linspace(0.0, 1.0, width, device=source_rgb.device),
                indexing="ij",
            )
            sample_x = 0.5 + (grid_x - anchor_x) / max(effect_scale, 0.05)
            sample_y = 0.5 + (grid_y - anchor_y) / max(effect_scale, 0.05)
            grid = torch.stack((sample_x * 2.0 - 1.0, sample_y * 2.0 - 1.0), dim=-1)
            grid = grid.unsqueeze(0).expand(batch, -1, -1, -1)
            warped = F.grid_sample(plate_chw, grid, mode="bilinear", padding_mode="zeros", align_corners=True)
            inside = ((sample_x >= 0.0) & (sample_x <= 1.0) & (sample_y >= 0.0) & (sample_y <= 1.0)).float()
            white_fill = torch.ones((1, 3, 1, 1), device=warped.device)
            warped = warped * inside.unsqueeze(0).unsqueeze(0) + white_fill * (1.0 - inside).unsqueeze(0).unsqueeze(0)
            effect_rgb = warped.permute(0, 2, 3, 1).clamp(0.0, 1.0)

            luminance = effect_rgb.mean(dim=-1)
            base_alpha = ((1.0 - luminance - white_threshold) / max(1.0 - white_threshold, 0.05)).clamp(0.0, 1.0)
            local_background = F.avg_pool2d(luminance.unsqueeze(1), 129, 1, 64).squeeze(1)
            local_contrast = (local_background - luminance).clamp(0.0, 1.0)
            detail_gate = ((local_contrast - 0.025) / 0.14).clamp(0.0, 1.0)
            alpha = base_alpha * (0.28 + 0.72 * detail_gate)
            alpha = alpha.pow(0.58) * float(effect_strength)
            alpha = F.avg_pool2d(alpha.unsqueeze(1), 3, 1, 1).squeeze(1).clamp(0.0, 0.96)
            smoke_tone = (0.28 + 0.52 * luminance).unsqueeze(-1)
            effect_rgb = (effect_rgb * smoke_tone).clamp(0.0, 1.0)

            depth_value = depth[..., :1].float()
            depth_value = F.interpolate(depth_value.permute(0, 3, 1, 2), size=(height, width), mode="bilinear", align_corners=False).squeeze(1)
            subject = _as_mask(subject_mask, height, width, source_rgb.device)
            near_subject = torch.sigmoid((0.52 - depth_value) * 14.0)
            front_alpha = (alpha * subject * near_subject * 0.28).unsqueeze(-1)
            back_alpha = (alpha * (1.0 - subject * near_subject)).unsqueeze(-1)
            back_result = effect_rgb * back_alpha + source_rgb * (1.0 - back_alpha)
            subject_rgb = source_rgb * subject.unsqueeze(-1) + back_result * (1.0 - subject.unsqueeze(-1))
            result = effect_rgb * front_alpha + subject_rgb * (1.0 - front_alpha)
            return (result.clamp(0.0, 1.0),)
