export interface SelectionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CapturedSelectionPayload {
  documentId: string;
  bounds: SelectionBounds;
  imageBase64: string;
  maskBase64: string;
  colorMode?: string;
  resolution?: number;
}

export interface GenerationRequest {
  presetId: string;
  prompt: string;
  negativePrompt?: string;
  selection: CapturedSelectionPayload;
  adapter: {
    provider: string;
    endpoint: string;
    workflow?: string;
  };
  parameters: Record<string, unknown>;
  correlationId: string;
}

export interface GenerationResponse {
  correlationId: string;
  result: {
    imageBase64: string;
    mimeType: string;
    seed?: number;
    metadata?: Record<string, unknown>;
  };
}

export interface LayerPlacementPayload {
  imageBase64: string;
  bounds: SelectionBounds;
  layerName: string;
  maskBase64?: string;
}
