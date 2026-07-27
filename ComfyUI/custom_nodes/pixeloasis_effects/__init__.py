"""
PixelOasis Effects — ComfyUI custom node package.
Provides deterministic RGBA smoke, dust, depth, and compositing nodes.

Nodes:
  PO_DepthEstimate     — Depth estimation via Depth Anything V2
  PO_FractalSmokeRGBA  — Multi-octave FBM fractal smoke (RGBA)
  PO_DustParticlesRGBA — Particle dust field (RGBA)
  PO_DepthSplitRGBA    — Split RGBA into back/front by depth + subject mask
  PO_RGBAComposite     — Composite source + back + front layers
  PO_SaveLayeredImage  — Save with layer metadata
"""

from .smoke_nodes import PO_FractalSmokeRGBA, PO_DustParticlesRGBA, PO_SubjectMaskResolve
from .depth_nodes import PO_DepthEstimate, PO_DepthSplitRGBA
from .image_nodes import PO_RGBAComposite, PO_MergeRGBA, PO_SaveLayeredImage
from .vfx_nodes import PO_VFXPlateComposite, PO_VFXPromptBuilder

NODE_CLASS_MAPPINGS = {
    "PO_FractalSmokeRGBA": PO_FractalSmokeRGBA,
    "PO_DustParticlesRGBA": PO_DustParticlesRGBA,
    "PO_SubjectMaskResolve": PO_SubjectMaskResolve,
    "PO_DepthEstimate": PO_DepthEstimate,
    "PO_DepthSplitRGBA": PO_DepthSplitRGBA,
    "PO_RGBAComposite": PO_RGBAComposite,
    "PO_MergeRGBA": PO_MergeRGBA,
    "PO_SaveLayeredImage": PO_SaveLayeredImage,
    "PO_VFXPlateComposite": PO_VFXPlateComposite,
    "PO_VFXPromptBuilder": PO_VFXPromptBuilder,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PO_FractalSmokeRGBA": "PO Fractal Smoke RGBA",
    "PO_DustParticlesRGBA": "PO Dust Particles RGBA",
    "PO_SubjectMaskResolve": "PO Subject Mask Resolve",
    "PO_DepthEstimate": "PO Depth Estimate",
    "PO_DepthSplitRGBA": "PO Depth Split RGBA",
    "PO_RGBAComposite": "PO RGBA Composite",
    "PO_MergeRGBA": "PO Merge RGBA",
    "PO_SaveLayeredImage": "PO Save Layered Image",
    "PO_VFXPlateComposite": "PO VFX Plate Composite",
    "PO_VFXPromptBuilder": "PO VFX Prompt Builder",
}

__all__ = [
    "PO_FractalSmokeRGBA", "PO_DustParticlesRGBA", "PO_SubjectMaskResolve",
    "PO_DepthEstimate", "PO_DepthSplitRGBA", "PO_MergeRGBA",
    "PO_RGBAComposite", "PO_SaveLayeredImage",
    "PO_VFXPlateComposite",
    "PO_VFXPromptBuilder",
]
