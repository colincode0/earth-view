import type { BoundingBox } from "../types/imagery";
import { getSentinelVariant } from "../lib/sentinelVariants";

const TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process";

type SentinelRequest = {
  bbox: BoundingBox;
  date: string;
  variantId?: string;
  width?: number;
  height?: number;
};

type SentinelEnv = {
  COPERNICUS_CLIENT_ID?: string;
  COPERNICUS_CLIENT_SECRET?: string;
  SENTINELHUB_CLIENT_ID?: string;
  SENTINELHUB_CLIENT_SECRET?: string;
};

type TokenResponse = {
  access_token: string;
  expires_in?: number;
};

let tokenCache: { token: string; expiresAt: number } | null = null;

export class SentinelError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "SentinelError";
    this.status = status;
  }
}

function getCredentials(env: SentinelEnv) {
  const clientId = env.COPERNICUS_CLIENT_ID ?? env.SENTINELHUB_CLIENT_ID;
  const clientSecret = env.COPERNICUS_CLIENT_SECRET ?? env.SENTINELHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new SentinelError(
      "Sentinel-2 credentials are not configured. Set COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET, then restart the dev server.",
      503,
    );
  }

  return { clientId, clientSecret };
}

async function getAccessToken(env: SentinelEnv) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const { clientId, clientSecret } = getCredentials(env);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new SentinelError("Could not authenticate with Copernicus Data Space.", 502);
  }

  const token = (await response.json()) as TokenResponse;
  tokenCache = {
    token: token.access_token,
    expiresAt: Date.now() + (token.expires_in ?? 600) * 1000,
  };

  return tokenCache.token;
}

function dateWindow(date: string, requestWindowDays: number) {
  const end = new Date(`${date}T23:59:59Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - requestWindowDays);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function validateRequest(input: SentinelRequest) {
  if (!input.bbox || !input.date) {
    throw new SentinelError("Missing bbox or date for Sentinel request.", 400);
  }

  return {
    bbox: input.bbox,
    date: input.date,
    variantId: input.variantId,
    width: Math.min(1024, Math.max(256, Math.round(input.width ?? 1024))),
    height: Math.min(1024, Math.max(256, Math.round(input.height ?? 1024))),
  };
}

function dataConfig(
  variant: ReturnType<typeof getSentinelVariant>,
  timeRange: ReturnType<typeof dateWindow>,
) {
  if (variant.collection === "sentinel-1-grd") {
    return {
      type: variant.collection,
      dataFilter: {
        timeRange,
        mosaickingOrder: "mostRecent",
        acquisitionMode: "IW",
        polarization: "DV",
        resolution: "HIGH",
      },
      processing: {
        orthorectify: true,
        backCoeff: "GAMMA0_TERRAIN",
        speckleFilter: {
          type: "LEE",
          windowSizeX: 3,
          windowSizeY: 3,
        },
      },
    };
  }

  return {
    type: variant.collection,
    dataFilter: {
      timeRange,
      mosaickingOrder: "leastCC",
      maxCloudCoverage: 60,
    },
  };
}

export async function fetchSentinelImage(input: SentinelRequest, env: SentinelEnv) {
  const request = validateRequest(input);
  const variant = getSentinelVariant(request.variantId);
  const token = await getAccessToken(env);
  const timeRange = dateWindow(request.date, variant.requestWindowDays);

  const body = {
    input: {
      bounds: {
        bbox: [
          request.bbox.minLon,
          request.bbox.minLat,
          request.bbox.maxLon,
          request.bbox.maxLat,
        ],
        properties: {
          crs: "http://www.opengis.net/def/crs/EPSG/0/4326",
        },
      },
      data: [
        dataConfig(variant, timeRange),
      ],
    },
    output: {
      width: request.width,
      height: request.height,
      responses: [
        {
          identifier: "default",
          format: {
            type: "image/png",
          },
        },
      ],
    },
    evalscript: variant.evalscript,
  };

  const response = await fetch(PROCESS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "image/png",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new SentinelError(
      detail || "Sentinel-2 imagery is unavailable for this area/date.",
      response.status,
    );
  }

  return {
    contentType: response.headers.get("content-type") ?? "image/png",
    bytes: await response.arrayBuffer(),
  };
}
