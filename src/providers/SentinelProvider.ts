import { getSentinelVariant, type SentinelVariantId } from "@/lib/sentinelVariants";
import type { ImageryProvider, ImageryRequest } from "@/types/imagery";

type SentinelProviderConfig = {
  id: string;
  variantId: SentinelVariantId;
};

type SentinelImageError = {
  error?: string;
};

export class SentinelProvider implements ImageryProvider {
  id: string;
  layerId?: string;
  sentinelVariantId: SentinelVariantId;
  name: string;
  satellite: string;
  category: string;
  resolution: number;
  requiresAuth = true;
  summary: string;
  bestFor: string;
  caveat: string;
  loadingMessage = "Sentinel data takes longer to load.";

  constructor(config: SentinelProviderConfig) {
    const variant = getSentinelVariant(config.variantId);

    this.id = config.id;
    this.sentinelVariantId = variant.id;
    this.name = variant.name;
    this.satellite = variant.satellite;
    this.category = variant.category;
    this.resolution = variant.resolution;
    this.summary = variant.summary;
    this.bestFor = variant.bestFor;
    this.caveat = variant.caveat;
  }

  async fetchImage(params: ImageryRequest) {
    const response = await fetch("/api/sentinel-image", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bbox: params.bbox,
        date: params.date,
        sceneDateTime: params.sceneDateTime,
        variantId: this.sentinelVariantId,
        width: params.width,
        height: params.height,
      }),
    });

    if (!response.ok) {
      let message = `${this.name} imagery is unavailable for this area/date.`;

      try {
        const body = (await response.json()) as SentinelImageError;
        message = body.error ?? message;
      } catch {
        message = await response.text();
      }

      throw new Error(message);
    }

    return response.blob();
  }
}
