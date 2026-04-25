export type SentinelCollection = "sentinel-2-l2a" | "sentinel-1-grd";

export type SentinelVariant = {
  id: string;
  name: string;
  shortName: string;
  collection: SentinelCollection;
  category: string;
  satellite: string;
  resolution: number;
  requestWindowDays: number;
  summary: string;
  bestFor: string;
  caveat: string;
  evalscript: string;
};

export const sentinelVariants = [
  {
    id: "s2-true-color",
    name: "Sentinel-2 True Color",
    shortName: "True color",
    collection: "sentinel-2-l2a",
    category: "Optical",
    satellite: "Sentinel-2 MSI",
    resolution: 10,
    requestWindowDays: 10,
    summary: "Natural-color Sentinel-2 L2A imagery using red, green, and blue bands.",
    bestFor: "A photographic-looking high-resolution view when the sky is clear.",
    caveat: "Clouds, haze, and shadows still block or obscure the surface.",
    evalscript: `//VERSION=3
function setup() {
  return {
    input: ["B04", "B03", "B02", "dataMask"],
    output: { bands: 4 }
  };
}

function evaluatePixel(sample) {
  return [
    Math.min(1, 2.5 * sample.B04),
    Math.min(1, 2.5 * sample.B03),
    Math.min(1, 2.5 * sample.B02),
    sample.dataMask
  ];
}`,
  },
  {
    id: "s2-false-color",
    name: "Sentinel-2 False Color IR",
    shortName: "False color IR",
    collection: "sentinel-2-l2a",
    category: "Optical",
    satellite: "Sentinel-2 MSI",
    resolution: 10,
    requestWindowDays: 10,
    summary: "Near-infrared, red, and green composite that makes vegetation stand out.",
    bestFor: "Vegetation density, land/water contrast, and surface change in clear scenes.",
    caveat: "Infrared improves interpretation but does not see through opaque clouds.",
    evalscript: `//VERSION=3
function setup() {
  return {
    input: ["B08", "B04", "B03", "dataMask"],
    output: { bands: 4 }
  };
}

function evaluatePixel(sample) {
  return [
    Math.min(1, 2.5 * sample.B08),
    Math.min(1, 2.5 * sample.B04),
    Math.min(1, 2.5 * sample.B03),
    sample.dataMask
  ];
}`,
  },
  {
    id: "s2-swir",
    name: "Sentinel-2 SWIR",
    shortName: "SWIR",
    collection: "sentinel-2-l2a",
    category: "Optical",
    satellite: "Sentinel-2 MSI",
    resolution: 20,
    requestWindowDays: 10,
    summary: "Shortwave-infrared false color for moisture, burn scars, snow, and clouds.",
    bestFor: "Burn scars, wet ground, flooded areas, snow/cloud separation, and smoke context.",
    caveat: "The SWIR band is 20m, and clouds still hide the ground beneath them.",
    evalscript: `//VERSION=3
function setup() {
  return {
    input: ["B12", "B08", "B04", "dataMask"],
    output: { bands: 4 }
  };
}

function evaluatePixel(sample) {
  return [
    Math.min(1, 3.0 * sample.B12),
    Math.min(1, 2.5 * sample.B08),
    Math.min(1, 2.5 * sample.B04),
    sample.dataMask
  ];
}`,
  },
  {
    id: "s1-radar",
    name: "Sentinel-1 Radar",
    shortName: "Radar",
    collection: "sentinel-1-grd",
    category: "SAR",
    satellite: "Sentinel-1 SAR",
    resolution: 10,
    requestWindowDays: 21,
    summary: "Synthetic aperture radar imagery that can image through clouds and at night.",
    bestFor: "Cloudy scenes, floods, water/land boundaries, surface roughness, and urban texture.",
    caveat: "Radar is not photographic; brightness reflects microwave backscatter, not visible color.",
    evalscript: `//VERSION=3
function setup() {
  return {
    input: ["VV", "VH", "dataMask"],
    output: { bands: 4 }
  };
}

function scaleDb(value, min, max) {
  var db = 10 * Math.log(value) / Math.LN10;
  return Math.max(0, Math.min(1, (db - min) / (max - min)));
}

function evaluatePixel(sample) {
  var vv = scaleDb(sample.VV, -20, 0);
  var vh = scaleDb(sample.VH, -26, -5);

  return [
    vv,
    vh,
    Math.max(0, Math.min(1, 0.65 * vv + 0.35 * vh)),
    sample.dataMask
  ];
}`,
  },
] satisfies SentinelVariant[];

export type SentinelVariantId = (typeof sentinelVariants)[number]["id"];

export function getSentinelVariant(id?: string) {
  return sentinelVariants.find((variant) => variant.id === id) ?? sentinelVariants[0];
}
