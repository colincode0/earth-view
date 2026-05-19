import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import { cityLabels } from "@/lib/cities";
import { latLonToVector } from "@/lib/geo";
import { useAppStore } from "@/store/useAppStore";

const LABEL_RADIUS = 1.008;
const HORIZON_DOT_THRESHOLD = 0.22;

function visibleTier(distance: number) {
  if (distance > 3.7) {
    return 1;
  }

  if (distance > 2.4) {
    return 2;
  }

  return 3;
}

export function CityLabels() {
  const modalOpen = useAppStore((state) => state.modalOpen);
  const atMaxZoom = useAppStore((state) => state.globeView?.atMaxZoom ?? false);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const cameraDirectionRef = useRef(new Vector3());
  const labels = useMemo(
    () =>
      cityLabels.map((city) => ({
        ...city,
        position: latLonToVector(city.lat, city.lon, LABEL_RADIUS),
        normal: latLonToVector(city.lat, city.lon).normalize(),
      })),
    [],
  );

  useFrame(({ camera }) => {
    if (modalOpen || atMaxZoom) {
      return;
    }

    const distance = camera.position.length();
    const maxTier = visibleTier(distance);

    cameraDirectionRef.current.copy(camera.position).normalize();

    labels.forEach((city, index) => {
      const label = labelRefs.current[index];

      if (!label) {
        return;
      }

      const isFacingCamera = city.normal.dot(cameraDirectionRef.current) > HORIZON_DOT_THRESHOLD;
      label.style.display =
        !modalOpen && !atMaxZoom && city.tier <= maxTier && isFacingCamera ? "block" : "none";
    });
  });

  if (modalOpen || atMaxZoom) {
    return null;
  }

  return (
    <group>
      {labels.map((city, index) => (
        <Html key={city.name} center position={city.position} zIndexRange={[0, 0]}>
          <span
            ref={(node) => {
              labelRefs.current[index] = node;
            }}
            className="city-label"
          >
            {city.name}
          </span>
        </Html>
      ))}
    </group>
  );
}
