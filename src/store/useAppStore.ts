import { create } from "zustand";
import { getLatestTrueColorImagery } from "@/lib/dates";
import {
  DEFAULT_IMAGERY_ZOOM_DEGREES,
  IMAGERY_ZOOM_MAX_DEGREES,
  IMAGERY_ZOOM_MIN_DEGREES,
  clamp,
} from "@/lib/geo";
import { modalImageryProviders } from "@/providers/registry";

type SelectedPoint = {
  lat: number;
  lon: number;
  imageryView?: ImageryView;
};

type ImageryView = {
  latSpan: number;
  lonSpan: number;
  pixelWidth: number;
  pixelHeight: number;
};

type GlobeView = {
  lat: number;
  lon: number;
  latSpan: number;
  lonSpan: number;
  distance: number;
  atMaxZoom: boolean;
};

type GlobeFocusRequest = {
  lat: number;
  lon: number;
  immediate: boolean;
  nonce: number;
};

type ModalReturnState = {
  date: string;
  layerId: string;
  dateManuallySelected: boolean;
  layerManuallySelected: boolean;
  overlayLayerIds: string[];
};

export type ActivityOverlayKey = "earthquakes" | "volcanoes" | "storms";

type AppState = {
  selectedPoint: SelectedPoint | null;
  globeView: GlobeView | null;
  globeFocusRequest: GlobeFocusRequest | null;
  modalOpen: boolean;
  modalReturnState: ModalReturnState | null;
  date: string;
  layerId: string;
  imageryVisible: boolean;
  overlayLayerIds: string[];
  activityOverlays: Record<ActivityOverlayKey, boolean>;
  dateManuallySelected: boolean;
  layerManuallySelected: boolean;
  imageryZoomDegrees: number;
  selectPoint: (lat: number, lon: number, zoom?: number | ImageryView) => void;
  recenterPoint: (lat: number, lon: number) => void;
  setGlobeView: (view: GlobeView) => void;
  focusGlobeAt: (
    lat: number,
    lon: number,
    options?: { immediate?: boolean; syncView?: boolean },
  ) => void;
  closeModal: () => void;
  setDate: (date: string) => void;
  setLayer: (id: string) => void;
  toggleImageryVisible: () => void;
  addOverlayLayer: (id: string) => void;
  removeOverlayLayer: (id: string) => void;
  moveOverlayLayer: (id: string, direction: "up" | "down") => void;
  clearOverlayLayers: () => void;
  toggleActivityOverlay: (key: ActivityOverlayKey) => void;
  setImageryZoomDegrees: (degrees: number) => void;
};

const initialTrueColorImagery = getLatestTrueColorImagery();
const defaultModalLayerId =
  modalImageryProviders.find((provider) => provider.sentinelVariantId)?.id ??
  initialTrueColorImagery.layerId;

export const useAppStore = create<AppState>((set) => ({
  selectedPoint: null,
  globeView: null,
  globeFocusRequest: null,
  modalOpen: false,
  modalReturnState: null,
  date: initialTrueColorImagery.date,
  layerId: initialTrueColorImagery.layerId,
  imageryVisible: true,
  overlayLayerIds: [],
  activityOverlays: { earthquakes: false, volcanoes: false, storms: false },
  dateManuallySelected: false,
  layerManuallySelected: false,
  imageryZoomDegrees: DEFAULT_IMAGERY_ZOOM_DEGREES,
  selectPoint: (lat, lon, zoom) =>
    set((state) => {
      const latestTrueColorImagery = getLatestTrueColorImagery();
      const zoomDegrees = typeof zoom === "number" ? zoom : zoom?.lonSpan;

      return {
        selectedPoint: { lat, lon, imageryView: typeof zoom === "object" ? zoom : undefined },
        modalOpen: true,
        modalReturnState: state.modalOpen
          ? state.modalReturnState
          : {
              date: state.date,
              layerId: state.layerId,
              dateManuallySelected: state.dateManuallySelected,
              layerManuallySelected: state.layerManuallySelected,
              overlayLayerIds: state.overlayLayerIds,
            },
        date: state.dateManuallySelected ? state.date : latestTrueColorImagery.date,
        layerId: state.layerManuallySelected ? state.layerId : defaultModalLayerId,
        imageryZoomDegrees:
          zoomDegrees === undefined
            ? state.globeView?.atMaxZoom
              ? clamp(state.globeView.lonSpan, IMAGERY_ZOOM_MIN_DEGREES, IMAGERY_ZOOM_MAX_DEGREES)
              : state.imageryZoomDegrees
            : clamp(zoomDegrees, IMAGERY_ZOOM_MIN_DEGREES, IMAGERY_ZOOM_MAX_DEGREES),
      };
    }),
  recenterPoint: (lat, lon) =>
    set((state) => ({
      selectedPoint: state.selectedPoint
        ? {
            ...state.selectedPoint,
            lat,
            lon,
          }
        : { lat, lon },
    })),
  setGlobeView: (globeView) => set({ globeView }),
  focusGlobeAt: (lat, lon, options) =>
    set((state) => ({
      globeFocusRequest: {
        lat,
        lon,
        immediate: options?.immediate ?? false,
        nonce: (state.globeFocusRequest?.nonce ?? 0) + 1,
      },
      globeView: (options?.syncView ?? true) && state.globeView
        ? {
            ...state.globeView,
            lat,
            lon,
          }
        : state.globeView,
    })),
  closeModal: () =>
    set((state) => {
      if (!state.modalReturnState) {
        return { modalOpen: false };
      }

      return {
        modalOpen: false,
        date: state.modalReturnState.date,
        layerId: state.modalReturnState.layerId,
        dateManuallySelected: state.modalReturnState.dateManuallySelected,
        layerManuallySelected: state.modalReturnState.layerManuallySelected,
        overlayLayerIds: state.modalReturnState.overlayLayerIds,
        modalReturnState: null,
      };
    }),
  setDate: (date) => set({ date, dateManuallySelected: true }),
  setLayer: (layerId) =>
    set((state) => ({
      layerId,
      layerManuallySelected: true,
      overlayLayerIds: state.overlayLayerIds.filter((id) => id !== layerId),
    })),
  toggleImageryVisible: () =>
    set((state) => ({
      imageryVisible: !state.imageryVisible,
    })),
  addOverlayLayer: (id) =>
    set((state) => {
      if (id === state.layerId || state.overlayLayerIds.includes(id)) {
        return state;
      }
      return { overlayLayerIds: [...state.overlayLayerIds, id] };
    }),
  removeOverlayLayer: (id) =>
    set((state) => ({
      overlayLayerIds: state.overlayLayerIds.filter((existing) => existing !== id),
    })),
  moveOverlayLayer: (id, direction) =>
    set((state) => {
      const index = state.overlayLayerIds.indexOf(id);
      if (index < 0) return state;
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= state.overlayLayerIds.length) return state;
      const next = [...state.overlayLayerIds];
      [next[index], next[target]] = [next[target], next[index]];
      return { overlayLayerIds: next };
    }),
  clearOverlayLayers: () => set({ overlayLayerIds: [] }),
  toggleActivityOverlay: (key) =>
    set((state) => ({
      activityOverlays: { ...state.activityOverlays, [key]: !state.activityOverlays[key] },
    })),
  setImageryZoomDegrees: (imageryZoomDegrees) => set({ imageryZoomDegrees }),
}));
