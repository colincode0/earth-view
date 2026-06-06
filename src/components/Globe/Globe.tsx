import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { LoaderCircle } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Raycaster, Sphere, Vector2, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { buildGlobalGibsTextureUrl } from "@/providers/GibsProvider";
import { getImageryProvider } from "@/providers/registry";
import { useAppStore } from "@/store/useAppStore";
import { latLonToVector, normalizeLongitude, pointToLatLon } from "@/lib/geo";
import { BoundaryLines } from "./BoundaryLines";
import { CityLabels } from "./CityLabels";
import { Earth, PlaceholderEarth } from "./Earth";
import { ActivityHoverPopup } from "./EventOverlays/ActivityHoverPopup";
import { EarthquakeMarkers } from "./EventOverlays/EarthquakeMarkers";
import { StormTracks } from "./EventOverlays/StormTracks";
import { VolcanoMarkers } from "./EventOverlays/VolcanoMarkers";
import { Starfield } from "./Starfield";

const MIN_GLOBE_DISTANCE = 1.06;
const MAX_GLOBE_DISTANCE = 6;
const MAX_ZOOM_DISTANCE = 1.085;
const MIN_ROTATE_SPEED = 0.012;
const MAX_ROTATE_SPEED = 0.36;
const MIN_PAN_SPEED = 0.018;
const MAX_PAN_SPEED = 0.24;
const DRAG_SPEED_CURVE = 1.25;
const MIN_ZOOM_SPEED = 0.075;
const MAX_ZOOM_SPEED = 0.5;
const ZOOM_SPEED_CURVE = 1.45;
const SHIFT_WHEEL_ZOOM_MULTIPLIER = 3.5;
const VIEW_REPORT_INTERVAL = 8;
const INITIAL_GLOBE_TEXTURE_WIDTH = 4096;
const DETAILED_GLOBE_TEXTURE_WIDTH = 8192;

function zoomProgressForDistance(distance: number) {
  const progress = (distance - MIN_GLOBE_DISTANCE) / (MAX_GLOBE_DISTANCE - MIN_GLOBE_DISTANCE);

  return Math.min(1, Math.max(0, progress));
}

function AdaptiveControls() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const focusRequest = useAppStore((state) => state.globeFocusRequest);
  const setGlobeView = useAppStore((state) => state.setGlobeView);
  const lastFocusNonce = useRef(0);
  const frameCount = useRef(0);
  const lastReportedView = useRef<{
    lat: number;
    lon: number;
    latSpan: number;
    lonSpan: number;
    distance: number;
    atMaxZoom: boolean;
  } | null>(null);
  const raycasterRef = useRef(new Raycaster());
  const sphereRef = useRef(new Sphere(undefined, 1));
  const centerPointRef = useRef(new Vector2(0, 0));
  const intersectionRef = useRef(new Vector3());

  useEffect(() => {
    const element = gl.domElement;

    function handleShiftWheel(event: WheelEvent) {
      const controls = controlsRef.current;

      if (!controls || !event.shiftKey || event.deltaY === 0) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const zoomScale = Math.pow(controls.getZoomScale(), SHIFT_WHEEL_ZOOM_MULTIPLIER);

      if (event.deltaY < 0) {
        controls.dollyIn(zoomScale);
      } else {
        controls.dollyOut(zoomScale);
      }
    }

    element.addEventListener("wheel", handleShiftWheel, { capture: true, passive: false });
    return () => {
      element.removeEventListener("wheel", handleShiftWheel, { capture: true });
    };
  }, [gl]);

  useFrame(() => {
    const controls = controlsRef.current;

    if (!controls) {
      return;
    }

    if (focusRequest && focusRequest.nonce !== lastFocusNonce.current) {
      const distance = Math.max(MIN_GLOBE_DISTANCE, camera.position.distanceTo(controls.target));
      const direction = latLonToVector(focusRequest.lat, focusRequest.lon).normalize();
      const originalDamping = controls.enableDamping;

      controls.enableDamping = focusRequest.immediate ? false : originalDamping;
      controls.target.set(0, 0, 0);
      camera.position.copy(direction.multiplyScalar(distance));
      camera.lookAt(controls.target);
      controls.update();
      controls.enableDamping = originalDamping;
      lastFocusNonce.current = focusRequest.nonce;
    }

    const distance = camera.position.distanceTo(controls.target);
    const zoomProgress = zoomProgressForDistance(distance);
    const dragSpeedProgress = Math.pow(zoomProgress, DRAG_SPEED_CURVE);
    const zoomSpeedProgress = Math.pow(zoomProgress, ZOOM_SPEED_CURVE);

    controls.rotateSpeed = MIN_ROTATE_SPEED + dragSpeedProgress * (MAX_ROTATE_SPEED - MIN_ROTATE_SPEED);
    controls.panSpeed = MIN_PAN_SPEED + dragSpeedProgress * (MAX_PAN_SPEED - MIN_PAN_SPEED);
    controls.zoomSpeed = MIN_ZOOM_SPEED + zoomSpeedProgress * (MAX_ZOOM_SPEED - MIN_ZOOM_SPEED);

    frameCount.current += 1;

    if (frameCount.current % VIEW_REPORT_INTERVAL !== 0) {
      return;
    }

    function readSurfacePoint(ndcX: number, ndcY: number) {
      raycasterRef.current.setFromCamera(centerPointRef.current.set(ndcX, ndcY), camera);

      const point = raycasterRef.current.ray.intersectSphere(
        sphereRef.current,
        intersectionRef.current,
      );

      return point ? pointToLatLon(point) : null;
    }

    const centerPoint = readSurfacePoint(0, 0);

    if (!centerPoint) {
      return;
    }

    const leftPoint = readSurfacePoint(-1, 0);
    const rightPoint = readSurfacePoint(1, 0);
    const topPoint = readSurfacePoint(0, 1);
    const bottomPoint = readSurfacePoint(0, -1);
    const latSpan =
      topPoint && bottomPoint
        ? Math.max(0.01, Math.abs(topPoint.lat - bottomPoint.lat))
        : 8;
    const lonSpan =
      leftPoint && rightPoint
        ? Math.max(0.01, Math.abs(normalizeLongitude(rightPoint.lon - leftPoint.lon)))
        : 8;
    const { lat, lon } = centerPoint;
    const atMaxZoom = distance <= MAX_ZOOM_DISTANCE;
    const previous = lastReportedView.current;

    if (
      previous &&
      previous.atMaxZoom === atMaxZoom &&
      Math.abs(previous.distance - distance) < 0.005 &&
      Math.abs(previous.lat - lat) < 0.01 &&
      Math.abs(previous.lon - lon) < 0.01 &&
      Math.abs(previous.latSpan - latSpan) < 0.05 &&
      Math.abs(previous.lonSpan - lonSpan) < 0.05
    ) {
      return;
    }

    const nextView = { lat, lon, latSpan, lonSpan, distance, atMaxZoom };
    lastReportedView.current = nextView;
    setGlobeView(nextView);
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan
      enableDamping
      dampingFactor={0.08}
      minDistance={MIN_GLOBE_DISTANCE}
      maxDistance={MAX_GLOBE_DISTANCE}
      rotateSpeed={MIN_ROTATE_SPEED}
      zoomSpeed={MIN_ZOOM_SPEED}
      panSpeed={MIN_PAN_SPEED}
    />
  );
}

export function Globe() {
  const date = useAppStore((state) => state.date);
  const layerId = useAppStore((state) => state.layerId);
  const imageryVisible = useAppStore((state) => state.imageryVisible);
  const boundaryLinesVisible = useAppStore((state) => state.boundaryLinesVisible);
  const overlayLayerIds = useAppStore((state) => state.overlayLayerIds);
  const activityOverlays = useAppStore((state) => state.activityOverlays);
  const overlayLoadStatuses = useAppStore((state) => state.overlayLoadStatuses);
  const selectPoint = useAppStore((state) => state.selectPoint);
  const setOverlayLoadStatus = useAppStore((state) => state.setOverlayLoadStatus);
  const provider = getImageryProvider(layerId);
  const globeProvider = provider.layerId ? provider : getImageryProvider("viirs-noaa20");
  const baseDate = globeProvider.fixedDate ?? date;
  const textureUrl = buildGlobalGibsTextureUrl(globeProvider.layerId ?? "", baseDate, {
    width: INITIAL_GLOBE_TEXTURE_WIDTH,
  });
  const upgradeTextureUrl = buildGlobalGibsTextureUrl(globeProvider.layerId ?? "", baseDate, {
    width: DETAILED_GLOBE_TEXTURE_WIDTH,
  });
  const overlayTextures = useMemo(
    () =>
      overlayLayerIds
        .map((id) => {
          const overlay = getImageryProvider(id);
          if (!overlay.layerId) return null;
          const overlayDate = overlay.fixedDate ?? date;
          return {
            id,
            url: buildGlobalGibsTextureUrl(overlay.layerId, overlayDate, { transparent: true }),
          };
        })
        .filter((entry): entry is { id: string; url: string } => entry !== null),
    [date, overlayLayerIds],
  );
  const [loadedTextureUrl, setLoadedTextureUrl] = useState<string | null>(null);
  const globeLoading = loadedTextureUrl !== textureUrl && loadedTextureUrl !== upgradeTextureUrl;

  const handleEarthReady = useCallback((url: string) => {
    setLoadedTextureUrl(url);
  }, []);

  const handleOverlayReady = useCallback(
    (id: string, url: string) => {
      setOverlayLoadStatus(id, { state: "loaded", url });
    },
    [setOverlayLoadStatus],
  );

  useEffect(() => {
    overlayTextures.forEach((overlay) => {
      if (overlayLoadStatuses[overlay.id]?.url !== overlay.url) {
        setOverlayLoadStatus(overlay.id, { state: "loading", url: overlay.url });
      }
    });
  }, [overlayLoadStatuses, overlayTextures, setOverlayLoadStatus]);

  return (
    <div
      className="globe-stage absolute inset-0"
      data-testid="globe-stage"
      onDragStart={(event) => {
        event.preventDefault();
      }}
    >
      <Canvas
        className="globe-canvas"
        camera={{ position: [0, 0, 3.35], fov: 42, near: 0.01, far: 100 }}
        draggable={false}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onDragStart={(event) => {
          event.preventDefault();
        }}
      >
        <color attach="background" args={["#05070d"]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[4, 2.8, 2.2]} intensity={1.8} />
        <directionalLight position={[-3, -1.8, -3]} intensity={0.2} color="#ffffff" />
        <Starfield />
        <Suspense fallback={<PlaceholderEarth onSelect={selectPoint} />}>
          <Earth
            imageryVisible={imageryVisible}
            textureUrl={textureUrl}
            upgradeTextureUrl={upgradeTextureUrl}
            overlayTextures={overlayTextures}
            onSelect={selectPoint}
            onReady={handleEarthReady}
            onOverlayReady={handleOverlayReady}
          />
        </Suspense>
        {boundaryLinesVisible ? <BoundaryLines /> : null}
        <CityLabels />
        {activityOverlays.earthquakes ? <EarthquakeMarkers /> : null}
        {activityOverlays.volcanoes ? <VolcanoMarkers /> : null}
        {activityOverlays.storms ? <StormTracks /> : null}
        <ActivityHoverPopup />
        <AdaptiveControls />
      </Canvas>
      {imageryVisible && globeLoading && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-background/75 px-3 py-2 text-sm text-foreground shadow-xl backdrop-blur">
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
            Loading globe imagery
          </div>
        </div>
      )}
    </div>
  );
}
