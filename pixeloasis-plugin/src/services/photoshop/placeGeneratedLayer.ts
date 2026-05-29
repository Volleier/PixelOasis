import type { LayerPlacementPayload } from "../../domain/protocol";

export async function placeGeneratedLayer(
  payload: LayerPlacementPayload,
): Promise<void> {
  // Placeholder. Replace with UXP layer placement and mask creation.
  console.log("Place generated layer", payload.layerName, payload.bounds);
}
