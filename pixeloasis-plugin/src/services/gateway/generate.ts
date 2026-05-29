import type {
  GenerationRequest,
  GenerationResponse,
} from "../../domain/protocol";

export async function generate(
  gatewayUrl: string,
  request: GenerationRequest,
): Promise<GenerationResponse> {
  const response = await fetch(`${gatewayUrl}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Gateway request failed with status ${response.status}.`);
  }

  return (await response.json()) as GenerationResponse;
}
