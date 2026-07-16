"""
PO_DepthEstimate — Depth estimation using Depth Anything V2 Small.
PO_DepthSplitRGBA — Split RGBA layer into back/front by depth + subject mask.
"""

import torch
import torch.nn.functional as F


class PO_DepthEstimate:
    """Load Depth Anything V2 and estimate depth map from input image.

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
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("depth", "foreground_mask")
    FUNCTION = "estimate"
    CATEGORY = "PixelOasis/Effects"

    def estimate(self, image):
        with torch.inference_mode():
            batch, height, width, channels = image.shape

            # Placeholder: generate synthetic depth gradient for testing
            # Real implementation loads Depth Anything V2 model
            y_coords = torch.linspace(0, 1, height, dtype=torch.float32)
            x_coords = torch.linspace(0, 1, width, dtype=torch.float32)
            gy, gx = torch.meshgrid(y_coords, x_coords, indexing="ij")

            # Synthetic depth: center is closer, edges are farther
            depth = 1.0 - torch.sqrt((gx - 0.5) ** 2 + (gy - 0.5) ** 2) * 1.5
            depth = torch.clamp(depth, 0.0, 1.0)
            depth = depth.unsqueeze(0).unsqueeze(-1)

            # Foreground confidence: brighter in center
            fg_mask = (depth < 0.7).float()
            fg_mask = fg_mask.squeeze(-1)

            # Match batch size
            depth = depth.expand(batch, -1, -1, -1)
            fg_mask = fg_mask.expand(batch, -1, -1)

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
