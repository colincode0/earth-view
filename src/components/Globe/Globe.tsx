import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { LoaderCircle } from "lucide-react";
import { Suspense, useCallback, useRef, useState } from "react";
import { Raycaster, Sphere, Vector2, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { buildGlobalGibsTextureUrl } from "@/providers/GibsProvider";
import { getImageryProvider } from "@/providers/registry";
import { useAppStore } from "@/store/useAppStore";
import { latLonToVector, normalizeLongitude, pointToLatLon } from "@/lib/geo";
import { BoundaryLines } from "./BoundaryLines";
import { CityLabels } from "./CityLabels";
import { Earth, PlaceholderEarth } from "./Earth";
import { EarthquakeMarkers } from "./EventOverlays/EarthquakeMarkers";
import { StormTracks } from "./EventOverlays/StormTracks";
import { VolcanoMarkers } from "./EventOverlays/VolcanoMarkers";
import { Starfield } from "./Starfield";

const MIN_GLOBE_DISTANCE = 1.06;
const MAX_ZOOM_DISTANCE = 1.085;
const VIEW_REPORT_INTERVAL = 8;

function AdaptiveControls() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((state) => state.camera);
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
    const zoomProgress = Math.min(1, Math.max(0, (distance - 1.06) / (6 - 1.06)));

    controls.rotateSpeed = 0.04 + zoomProgress * 0.32;
    controls.panSpeed = 0.04 + zoomProgress * 0.2;
    controls.zoomSpeed = 0.24 + zoomProgress * 0.26;

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
      maxDistance={6}
      rotateSpeed={0.24}
      zoomSpeed={0.38}
      panSpeed={0.14}
    />
  );
}

export function Globe() {
  const date = useAppStore((state) => state.date);
  const layerId = useAppStore((state) => state.layerId);
  const overlayLayerIds = useAppStore((state) => state.overlayLayerIds);
  const activityOverlays = useAppStore((state) => state.activityOverlays);
  const selectPoint = useAppStore((state) => state.selectPoint);
  const provider = getImageryProvider(layerId);
  const globeProvider = provider.layerId ? provider : getImageryProvider("viirs-noaa20");
  const baseDate = globeProvider.fixedDate ?? date;
  const textureUrl = buildGlobalGibsTextureUrl(globeProvider.layerId ?? "", baseDate);
  const overlayTextures = overlayLayerIds
    .map((id) => {
      const overlay = getImageryProvider(id);
      if (!overlay.layerId) return null;
      const overlayDate = overlay.fixedDate ?? date;
      return {
        id,
        url: buildGlobalGibsTextureUrl(overlay.layerId, overlayDate, { transparent: true }),
      };
    })
    .filter((entry): entry is { id: string; url: string } => entry !== null);
  const [loadedTextureUrl, setLoadedTextureUrl] = useState<string | null>(null);
  const globeLoading = loadedTextureUrl !== textureUrl;

  const handleEarthReady = useCallback((url: string) => {
    setLoadedTextureUrl(url);
  }, []);

  return (
    <div className="absolute inset-0" data-testid="globe-stage">
      <Canvas
        camera={{ position: [0, 0, 3.35], fov: 42, near: 0.01, far: 100 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={["#05070d"]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[4, 2.8, 2.2]} intensity={1.8} />
        <directionalLight position={[-3, -1.8, -3]} intensity={0.2} color="#ffffff" />
        <Starfield />
        <Suspense fallback={<PlaceholderEarth onSelect={selectPoint} />}>
          <Earth
            textureUrl={textureUrl}
            overlayTextures={overlayTextures}
            onSelect={selectPoint}
            onReady={handleEarthReady}
          />
        </Suspense>
        <BoundaryLines />
        <CityLabels />
        {activityOverlays.earthquakes ? <EarthquakeMarkers /> : null}
        {activityOverlays.volcanoes ? <VolcanoMarkers /> : null}
        {activityOverlays.storms ? <StormTracks /> : null}
        <AdaptiveControls />
      </Canvas>
      {globeLoading && (
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
