import { Html } from "@react-three/drei";
import { useActivityHoverStore } from "./activityHoverStore";

export function ActivityHoverPopup() {
  const hoveredMarker = useActivityHoverStore((state) => state.hoveredMarker);

  if (!hoveredMarker) {
    return null;
  }

  return (
    <Html
      center
      position={hoveredMarker.position}
      zIndexRange={[9, 9]}
      style={{ pointerEvents: "none" }}
    >
      <div className="w-[min(320px,calc(100vw-2rem))] translate-x-[calc(50%+0.8rem)] -translate-y-1/2 rounded-lg border border-white/20 bg-[#05070d] p-3 text-left text-xs text-white shadow-2xl ring-1 ring-black/80">
        <div className="mb-2 flex items-start gap-2">
          <span
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-black"
            style={{ backgroundColor: hoveredMarker.color }}
          />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-normal text-white/55">
              {hoveredMarker.kind}
            </div>
            <div className="text-sm font-semibold leading-snug text-white">
              {hoveredMarker.title}
            </div>
            {hoveredMarker.subtitle ? (
              <div className="mt-0.5 text-[11px] leading-snug text-white/65">
                {hoveredMarker.subtitle}
              </div>
            ) : null}
          </div>
        </div>
        {hoveredMarker.occurredAt || hoveredMarker.recency ? (
          <div className="mb-2 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5">
            {hoveredMarker.occurredAt ? (
              <div className="text-[11px] leading-snug text-white/85">
                {hoveredMarker.occurredAt}
              </div>
            ) : null}
            {hoveredMarker.recency ? (
              <div className="text-[10px] leading-snug text-white/55">{hoveredMarker.recency}</div>
            ) : null}
          </div>
        ) : null}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-white/10 pt-2">
          {hoveredMarker.rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="whitespace-nowrap text-[10px] uppercase tracking-normal text-white/45">
                {row.label}
              </dt>
              <dd className="min-w-0 text-[11px] leading-snug text-white/80">{row.value}</dd>
            </div>
          ))}
        </dl>
        {hoveredMarker.sourceLabel || hoveredMarker.sourceUrl ? (
          <div className="mt-2 border-t border-white/10 pt-2 text-[10px] leading-snug text-white/45">
            Source: {hoveredMarker.sourceLabel ?? hoveredMarker.sourceUrl}
          </div>
        ) : null}
      </div>
    </Html>
  );
}
