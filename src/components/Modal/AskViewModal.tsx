import { Bot, LoaderCircle, RefreshCcw, Send } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BoundingBox } from "@/types/imagery";

export type AskProvider = "openai" | "anthropic";

export type AskChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AskViewContext = {
  coordinates: string;
  lat: number;
  lon: number;
  date: string;
  captureLabel: string;
  providerName: string;
  providerId: string;
  satellite: string;
  category: string;
  resolutionMeters: number;
  sentinelVariantId?: string;
  bbox?: BoundingBox | null;
  imageryZoomDegrees: number;
  imageWidth?: number | null;
  imageHeight?: number | null;
};

type AskViewModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  viewContext: AskViewContext | null;
  viewSignature: string;
};

type AskStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "done"; message: string; viewBriefing?: string }
  | { type: "error"; error: string };

const MAX_DIRECT_IMAGE_BYTES = 18 * 1024 * 1024;
const OVERSIZED_IMAGE_MAX_EDGE = 2400;

function providerLabel(provider: AskProvider) {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

function formatNumber(value: number, digits = 4) {
  return Number(value.toFixed(digits)).toString();
}

function bboxLabel(bbox?: BoundingBox | null) {
  if (!bbox) {
    return "unavailable";
  }

  return `${formatNumber(bbox.minLat)}, ${formatNumber(bbox.minLon)} to ${formatNumber(
    bbox.maxLat,
  )}, ${formatNumber(bbox.maxLon)}`;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the current view image for AI analysis."));
    image.src = url;
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not prepare the current view image for AI analysis."));
    reader.readAsDataURL(blob);
  });
}

function nextSseChunk(buffer: string) {
  const match = buffer.match(/\r?\n\r?\n/);

  if (!match || match.index === undefined) {
    return null;
  }

  return {
    chunk: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
  };
}

function parseSseData(chunk: string) {
  return chunk
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

async function imageToDataUrl(url: string) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Could not fetch the current view image for AI analysis.");
    }

    const blob = await response.blob();

    if (blob.size <= MAX_DIRECT_IMAGE_BYTES) {
      return await blobToDataUrl(blob);
    }
  } catch {
    // Fall back to canvas capture if direct blob capture is unavailable.
  }

  const image = await loadImage(url);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, OVERSIZED_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not prepare the current view image for AI analysis.");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  try {
    return scale < 1 ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
  } catch {
    throw new Error("The current image could not be captured for AI analysis.");
  }
}

async function requestAskViewStream(
  params: {
    provider: AskProvider;
    messages: AskChatMessage[];
    viewContext: AskViewContext;
    imageDataUrl?: string;
    viewBriefing?: string | null;
  },
  onEvent: (event: AskStreamEvent) => void,
) {
  const response = await fetch("/api/ask-view-stream", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    let message = "Ask View request failed.";

    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      message = await response.text();
    }

    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("Ask View stream did not return a readable response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let next = nextSseChunk(buffer);

    while (next) {
      buffer = next.rest;
      const data = parseSseData(next.chunk);

      if (data) {
        const event = JSON.parse(data) as AskStreamEvent;
        sawDone = sawDone || event.type === "done";
        onEvent(event);
      }

      next = nextSseChunk(buffer);
    }
  }

  const trailingData = parseSseData(buffer);

  if (trailingData) {
    const event = JSON.parse(trailingData) as AskStreamEvent;
    sawDone = sawDone || event.type === "done";
    onEvent(event);
  }

  if (!sawDone) {
    throw new Error("Ask View stream ended before the analysis completed.");
  }
}

export function AskViewModal({
  open,
  onOpenChange,
  imageUrl,
  viewContext,
  viewSignature,
}: AskViewModalProps) {
  const [askProvider, setAskProvider] = useState<AskProvider>("openai");
  const [messages, setMessages] = useState<AskChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewBriefing, setViewBriefing] = useState<string | null>(null);
  const [sessionSignature, setSessionSignature] = useState<string | null>(null);
  const [sessionProvider, setSessionProvider] = useState<AskProvider>("openai");
  const [sessionContext, setSessionContext] = useState<AskViewContext | null>(null);
  const [sessionImageUrl, setSessionImageUrl] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewChanged = Boolean(open && sessionSignature && sessionSignature !== viewSignature);
  const displayedContext = sessionContext ?? viewContext;
  const displayedImageUrl = sessionImageUrl ?? imageUrl;
  const sessionStarted = messages.length > 0 || Boolean(sessionSignature);
  const activeProvider = sessionStarted ? sessionProvider : askProvider;
  const askReady = Boolean(imageUrl && viewContext);
  const inputDisabled = loading || (!sessionStarted && !askReady);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [messages, loading]);

  useEffect(() => {
    if (!open) {
      setMessages([]);
      setInput("");
      setLoading(false);
      setError(null);
      setViewBriefing(null);
      setSessionSignature(null);
      setSessionProvider("openai");
      setSessionContext(null);
      setSessionImageUrl(null);
      setAskProvider("openai");
    }
  }, [open]);

  function resetForCurrentView() {
    setMessages([]);
    setInput("");
    setError(null);
    setViewBriefing(null);
    setSessionSignature(null);
    setSessionProvider(askProvider);
    setSessionContext(null);
    setSessionImageUrl(null);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = input.trim();

    if (!question || loading) {
      return;
    }

    const hasPriorAssistant = messages.some(
      (message) => message.role === "assistant" && message.content.trim().length > 0,
    );
    const isInitial = !hasPriorAssistant;

    if (isInitial && (!imageUrl || !viewContext)) {
      setError("There is no rendered image available to ask about yet.");
      return;
    }

    if (!isInitial && !sessionContext) {
      setError("This chat is missing its original view context. Start a new chat for the current view.");
      return;
    }

    const requestProvider = isInitial ? askProvider : sessionProvider;
    const requestContext = isInitial ? viewContext : sessionContext;
    const nextMessages = isInitial
      ? [{ role: "user" as const, content: question }]
      : [...messages, { role: "user" as const, content: question }];

    if (!requestContext) {
      setError("There is no view context available for this question.");
      return;
    }

    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);

    if (isInitial) {
      setSessionSignature(viewSignature);
      setSessionProvider(askProvider);
      setSessionContext(viewContext);
      setSessionImageUrl(imageUrl);
      setViewBriefing(null);
    }

    let assistantText = "";

    try {
      const imageDataUrl = isInitial && imageUrl ? await imageToDataUrl(imageUrl) : undefined;

      setMessages([...nextMessages, { role: "assistant", content: "" }]);

      await requestAskViewStream(
        {
          provider: requestProvider,
          messages: nextMessages,
          viewContext: requestContext,
          imageDataUrl,
          viewBriefing: isInitial ? null : viewBriefing,
        },
        (streamEvent) => {
          if (streamEvent.type === "error") {
            throw new Error(streamEvent.error);
          }

          if (streamEvent.type === "delta") {
            assistantText += streamEvent.delta;
            setMessages([...nextMessages, { role: "assistant", content: assistantText }]);
            return;
          }

          assistantText = streamEvent.message;
          setMessages([...nextMessages, { role: "assistant", content: assistantText }]);
          setViewBriefing(streamEvent.viewBriefing ?? (isInitial ? null : viewBriefing));
        },
      );
    } catch (requestError) {
      if (!assistantText.trim()) {
        setMessages(nextMessages);
      }

      setError(requestError instanceof Error ? requestError.message : "Ask View request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function retryInitialRequest() {
    const firstUserMessage = messages.find((message) => message.role === "user");

    if (!firstUserMessage?.content.trim() || !imageUrl || !viewContext || loading) {
      return;
    }

    const initialMessages = [{ role: "user" as const, content: firstUserMessage.content.trim() }];

    setMessages(initialMessages);
    setInput("");
    setError(null);
    setViewBriefing(null);
    setSessionSignature(viewSignature);
    setSessionProvider(askProvider);
    setSessionContext(viewContext);
    setSessionImageUrl(imageUrl);
    setLoading(true);

    let assistantText = "";

    try {
      const imageDataUrl = await imageToDataUrl(imageUrl);

      setMessages([...initialMessages, { role: "assistant", content: "" }]);

      await requestAskViewStream(
        {
          provider: sessionProvider,
          messages: initialMessages,
          viewContext,
          imageDataUrl,
        },
        (streamEvent) => {
          if (streamEvent.type === "error") {
            throw new Error(streamEvent.error);
          }

          if (streamEvent.type === "delta") {
            assistantText += streamEvent.delta;
            setMessages([...initialMessages, { role: "assistant", content: assistantText }]);
            return;
          }

          assistantText = streamEvent.message;
          setMessages([...initialMessages, { role: "assistant", content: assistantText }]);
          setViewBriefing(streamEvent.viewBriefing ?? null);
        },
      );
    } catch (requestError) {
      if (!assistantText.trim()) {
        setMessages(initialMessages);
      }

      setError(requestError instanceof Error ? requestError.message : "Ask View request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,920px)]">
        <div className="grid max-h-[86vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <DialogHeader className="border-b border-border p-5 pr-10">
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              Ask AI
            </DialogTitle>
            <DialogDescription>
              {providerLabel(activeProvider)} - {displayedContext?.providerName ?? "Current view"}
            </DialogDescription>
          </DialogHeader>

          <div ref={viewportRef} className="min-h-[420px] overflow-y-auto p-5">
            <div className="mb-4 overflow-hidden rounded-md border border-border bg-black">
              {displayedImageUrl ? (
                <img
                  src={displayedImageUrl}
                  alt="Current satellite view"
                  className="max-h-[280px] w-full object-contain"
                  draggable={false}
                />
              ) : (
                <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                  Current image unavailable
                </div>
              )}
            </div>

            {displayedContext && (
              <div className="mb-4 rounded-md border border-border bg-background/45 p-3 text-xs text-muted-foreground">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="font-medium text-foreground">{displayedContext.coordinates}</div>
                    <div>{displayedContext.captureLabel}</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{displayedContext.providerName}</div>
                    <div>
                      {displayedContext.satellite} - {displayedContext.category} -{" "}
                      {displayedContext.resolutionMeters}m nominal
                    </div>
                  </div>
                </div>
                <div className="mt-2 border-t border-border/60 pt-2 font-mono text-[11px]">
                  bbox {bboxLabel(displayedContext.bbox)} - zoom{" "}
                  {formatNumber(displayedContext.imageryZoomDegrees, 3)} deg
                </div>
              </div>
            )}

            <div className="mb-4">
              <Select
                value={activeProvider}
                onValueChange={(value) => setAskProvider(value as AskProvider)}
                disabled={sessionStarted || loading}
              >
                <SelectTrigger aria-label="AI provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {viewChanged && (
              <div className="mb-4 rounded-md border border-primary/35 bg-primary/10 p-3 text-sm text-foreground">
                <div className="mb-2 text-xs text-muted-foreground">
                  The imagery view changed after this chat started.
                </div>
                <Button type="button" variant="outline" size="sm" onClick={resetForCurrentView}>
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Start chat for current view
                </Button>
              </div>
            )}

            <div className="space-y-3">
              {messages.length === 0 && !loading && !error && (
                <div className="rounded-md border border-dashed border-border bg-background/35 px-3 py-6 text-center text-sm text-muted-foreground">
                  Ask a question about the current satellite view to start the chat.
                </div>
              )}

              {messages.map((message, index) => {
                if (message.role === "assistant" && !message.content.trim()) {
                  return null;
                }

                return (
                  <div
                    key={`${message.role}-${index}`}
                    className={`rounded-md border px-3 py-2 text-sm leading-relaxed ${
                      message.role === "assistant"
                        ? "border-border bg-background/55 text-foreground"
                        : "ml-auto max-w-[82%] border-primary/40 bg-primary/15 text-foreground"
                    }`}
                  >
                    {message.content}
                  </div>
                );
              })}

              {loading && (
                <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background/55 px-3 py-2 text-sm text-muted-foreground">
                  <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                  Analyzing view
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                  {!loading && messages.length > 0 && (
                    <div className="mt-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => void retryInitialRequest()}>
                        <RefreshCcw className="h-3.5 w-3.5" />
                        Retry analysis
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <form onSubmit={sendMessage} className="flex gap-2 border-t border-border p-4">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={inputDisabled}
              placeholder={sessionStarted ? "Ask a follow-up about this view" : "Ask about this view"}
              className="flex h-10 min-w-0 flex-1 rounded-md border border-input bg-background/70 px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
            />
            <Button type="submit" disabled={inputDisabled || !input.trim()}>
              <Send className="h-4 w-4" />
              Send
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
