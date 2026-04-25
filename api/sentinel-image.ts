import { fetchSentinelImage, SentinelError } from "../src/server/sentinel";

type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (status: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
  send: (body: Buffer) => void;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST for Sentinel image requests." });
    return;
  }

  try {
    const image = await fetchSentinelImage(req.body as Parameters<typeof fetchSentinelImage>[0], {
      COPERNICUS_CLIENT_ID: process.env.COPERNICUS_CLIENT_ID,
      COPERNICUS_CLIENT_SECRET: process.env.COPERNICUS_CLIENT_SECRET,
      SENTINELHUB_CLIENT_ID: process.env.SENTINELHUB_CLIENT_ID,
      SENTINELHUB_CLIENT_SECRET: process.env.SENTINELHUB_CLIENT_SECRET,
    });

    res.setHeader("content-type", image.contentType);
    res.status(200).send(Buffer.from(image.bytes));
  } catch (error) {
    const status = error instanceof SentinelError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Sentinel request failed.";
    res.status(status).json({ error: message });
  }
}
