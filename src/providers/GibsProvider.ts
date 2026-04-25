import type { BoundingBox, ImageryProvider, ImageryRequest } from "@/types/imagery";

const GIBS_WMS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

type GibsLayerConfig = {
  id: string;
  layerId: string;
  name: string;
  satellite: string;
  category: string;
  resolution: number;
  summary: string;
  bestFor: string;
  caveat: string;
};

function bboxParam(bbox: BoundingBox) {
  return [bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon]
    .map((value) => Number(value.toFixed(4)))
    .join(",");
}

export function buildGibsWmsUrl(layerId: string, params: ImageryRequest) {
  const search = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: layerId,
    CRS: "EPSG:4326",
    TIME: params.date,
    WIDTH: String(params.width),
    HEIGHT: String(params.height),
    BBOX: bboxParam(params.bbox),
    FORMAT: "image/png",
    TRANSPARENT: "FALSE",
  });

  return `${GIBS_WMS_URL}?${search.toString()}`;
}

export function buildGlobalGibsTextureUrl(layerId: string, date: string, width = 4096) {
  return buildGibsWmsUrl(layerId, {
    date,
    width,
    height: width / 2,
    bbox: {
      minLat: -90,
      minLon: -180,
      maxLat: 90,
      maxLon: 180,
    },
  });
}

export class GibsProvider implements ImageryProvider {
  id: string;
  layerId: string;
  name: string;
  satellite: string;
  category: string;
  resolution: number;
  summary: string;
  bestFor: string;
  caveat: string;
  requiresAuth = false;

  constructor(config: GibsLayerConfig) {
    this.id = config.id;
    this.layerId = config.layerId;
    this.name = config.name;
    this.satellite = config.satellite;
    this.category = config.category;
    this.resolution = config.resolution;
    this.summary = config.summary;
    this.bestFor = config.bestFor;
    this.caveat = config.caveat;
  }

  async fetchImage(params: ImageryRequest) {
    return buildGibsWmsUrl(this.layerId, params);
  }
}
