import { create } from "zustand";

export type ActivityDetailRow = {
  label: string;
  value: string;
};

export type ActivityMarkerDetail = {
  id: string;
  kind: "Earthquake" | "Volcano" | "Storm";
  title: string;
  subtitle?: string;
  occurredAt?: string;
  recency?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  rows: ActivityDetailRow[];
};

export type ActivityHoverMarker = ActivityMarkerDetail & {
  color: string;
  position: [number, number, number];
};

type ActivityHoverState = {
  hoveredMarker: ActivityHoverMarker | null;
  clearHoveredMarker: (id?: string) => void;
  setHoveredMarker: (marker: ActivityHoverMarker) => void;
};

export const useActivityHoverStore = create<ActivityHoverState>((set) => ({
  hoveredMarker: null,
  clearHoveredMarker: (id) =>
    set((state) => {
      if (id && state.hoveredMarker?.id !== id) {
        return state;
      }

      return { hoveredMarker: null };
    }),
  setHoveredMarker: (marker) =>
    set((state) => {
      if (
        state.hoveredMarker?.id === marker.id &&
        state.hoveredMarker.position[0] === marker.position[0] &&
        state.hoveredMarker.position[1] === marker.position[1] &&
        state.hoveredMarker.position[2] === marker.position[2]
      ) {
        return state;
      }

      return { hoveredMarker: marker };
    }),
}));
