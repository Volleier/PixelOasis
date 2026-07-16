"""
PO_RGBAComposite — Composite source + back + front RGBA layers.
PO_SaveLayeredImage — Save image with layer role metadata.
"""

import torch


class PO_RGBAComposite:
    """Composite source image with back and front RGBA layers.

    Uses proper alpha premultiplication. Preserves source dimensions.

    Inputs:
        source         — original image (B, H, W, 3)
        back           — behind-subject RGBA layer
        front          — in-front-of-subject RGBA layer
    Outputs:
        composite      — composited image (B, H, W, 3)
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "source": ("IMAGE",),
                "back": ("IMAGE",),
                "front": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("composite",)
    FUNCTION = "composite"
    CATEGORY = "PixelOasis/Effects"

    def composite(self, source, back, front):
        with torch.inference_mode():
            batch, h, w, c = source.shape

            # Resize back/front to source dimensions if needed
            if back.shape[1] != h or back.shape[2] != w:
                back = torch.nn.functional.interpolate(
                    back.permute(0, 3, 1, 2), size=(h, w),
                    mode='bilinear', align_corners=False
                ).permute(0, 2, 3, 1)

            if front.shape[1] != h or front.shape[2] != w:
                front = torch.nn.functional.interpolate(
                    front.permute(0, 3, 1, 2), size=(h, w),
                    mode='bilinear', align_corners=False
                ).permute(0, 2, 3, 1)

            # Alpha compositing: result = back_over_source, then front_over_result
            # back layer (has alpha channel)
            back_alpha = back[..., 3:4]
            back_rgb = back[..., :3]

            # Composite back over source
            result = back_rgb * back_alpha + source[..., :3] * (1.0 - back_alpha)

            # front layer over result
            front_alpha = front[..., 3:4]
            front_rgb = front[..., :3]
            result = front_rgb * front_alpha + result * (1.0 - front_alpha)

            result = torch.clamp(result, 0.0, 1.0)

        return (result,)


class PO_SaveLayeredImage:
    """Save an image with layer role metadata for artifact tracking.

    Inputs:
        image          — image to save
        role           — artifact role name (smoke/dust/compositePreview)
        filename_prefix — output filename prefix
    Outputs:
        IMAGE          — passthrough of input image
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "role": ("STRING", {"default": "result"}),
                "filename_prefix": ("STRING", {"default": "PixelOasis"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "save_layered"
    CATEGORY = "PixelOasis/Effects"
    OUTPUT_NODE = True

    def save_layered(self, image, role, filename_prefix):
        # ComfyUI handles the actual file saving.
        # The role + filename_prefix are stored in the workflow for
        # output-collector.js to map node outputs to artifact roles.
        return (image,)
