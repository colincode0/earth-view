import type { BoundingBox, SentinelSceneGeometry } from "@/types/imagery";
import type { TimeLapseFrame } from "../TimeLapseModal";

export type TimeLapseMode = 7 | 30 | "5y";

export type SentinelState = {
  imageUrl: string;
  bbox: BoundingBox;
  variantId: string;
  sceneDateTime?: string;
} | null;

export type SentinelScene = {
  dateTime: string;
  cloudCover: number | null;
  itemIds: string[];
  geometries?: SentinelSceneGeometry[];
};

export type SentinelTimeLapseCacheValue = {
  frames: TimeLapseFrame[];
  error: string | null;
};

export type ManagedObjectUrl = {
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url?: string | null) => void;
};
