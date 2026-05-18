export type BoundingBox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

export type SentinelScenePosition = [number, number] | [number, number, number];

export type SentinelSceneGeometry =
  | {
      type: "Polygon";
      coordinates: SentinelScenePosition[][];
    }
  | {
      type: "MultiPolygon";
      coordinates: SentinelScenePosition[][][];
    };

export type ImageryRequest = {
  bbox: BoundingBox;
  date: string;
  sceneDateTime?: string;
  width: number;
  height: number;
};

export interface ImageryProvider {
  id: string;
  layerId?: string;
  name: string;
  satellite: string;
  category: string;
  resolution: number;
  requiresAuth: boolean;
  summary: string;
  bestFor: string;
  caveat: string;
  loadingMessage?: string;
  sentinelVariantId?: string;
  overlayOnly?: boolean;
  fixedDate?: string;
  fetchImage(params: ImageryRequest): Promise<string | Blob>;
}
