import { Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { DoubleSide, Vector3, type Group, type Intersection, type Object3D } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  type ActivityHoverMarker,
  type ActivityMarkerDetail,
  useActivityHoverStore,
} from "./activityHoverStore";

type ActivityCrosshairProps = {
  color: string;
  detail?: ActivityMarkerDetail;
  opacity?: number;
  position: [number, number, number];
  sizeMultiplier?: number;
  variant?: "crosshair" | "volcano";
};

const MIN_SIZE = 0.004;
const MAX_SIZE = 0.05;
const DISTANCE_SCALE = 0.018;
const ARM_LENGTH = 0.68;
const ARM_THICKNESS = 0.075;
const ARM_OFFSET = 0.46;
const STROKE_ARM_LENGTH = 0.84;
const STROKE_ARM_THICKNESS = 0.18;
const HIT_SIZE = 1.18;
const VOLCANO_ARM_LENGTH = 1.06;
const VOLCANO_STROKE_LENGTH = 1.22;

type ActivityHitUserData = {
  activityMarker?: ActivityHoverMarker;
};

const markerPosition = new Vector3();

function readActivityMarker(object: Object3D) {
  return (object.userData as ActivityHitUserData).activityMarker ?? null;
}

function localDistanceFromHitCenter(intersection: Intersection) {
  const localPoint = intersection.point.clone();
  intersection.object.worldToLocal(localPoint);

  return Math.hypot(localPoint.x, localPoint.y);
}

function closestActivityMarker(
  intersections: Intersection[],
  cameraPosition: Vector3,
): ActivityHoverMarker | null {
  let closest: { marker: ActivityHoverMarker; distance: number } | null = null;

  for (const intersection of intersections) {
    const marker = readActivityMarker(intersection.object);

    if (!marker) {
      continue;
    }

    markerPosition.fromArray(marker.position);
    if (markerPosition.dot(cameraPosition) <= 0) {
      continue;
    }

    const distance = localDistanceFromHitCenter(intersection);
    if (!closest || distance < closest.distance) {
      closest = { marker, distance };
    }
  }

  return closest?.marker ?? null;
}

export function ActivityCrosshair({
  color,
  detail,
  opacity = 0.95,
  position,
  sizeMultiplier = 1,
  variant = "crosshair",
}: ActivityCrosshairProps) {
  const groupRef = useRef<Group>(null);
  const setHoveredMarker = useActivityHoverStore((state) => state.setHoveredMarker);
  const clearHoveredMarker = useActivityHoverStore((state) => state.clearHoveredMarker);
  const hoverMarker = detail ? { ...detail, color, position } : null;
  const detailId = detail?.id;

  useEffect(
    () => () => {
      if (detailId) {
        clearHoveredMarker(detailId);
      }
    },
    [clearHoveredMarker, detailId],
  );

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;

    const cameraDistance = camera.position.distanceTo(group.position);
    const size = Math.min(
      MAX_SIZE,
      Math.max(MIN_SIZE, cameraDistance * DISTANCE_SCALE * sizeMultiplier),
    );
    group.scale.setScalar(size);
  });

  function handlePointerMove(event: ThreeEvent<PointerEvent>) {
    if (!hoverMarker) {
      return;
    }

    const closestMarker = closestActivityMarker(event.intersections, event.camera.position);
    if (closestMarker) {
      setHoveredMarker(closestMarker);
    }
  }

  return (
    <Billboard ref={groupRef} position={position}>
      {hoverMarker ? (
        <mesh
          userData={{ activityMarker: hoverMarker } satisfies ActivityHitUserData}
          onPointerMove={handlePointerMove}
          onPointerOut={() => clearHoveredMarker(hoverMarker.id)}
        >
          <planeGeometry args={[HIT_SIZE, HIT_SIZE]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}
      {variant === "volcano"
        ? [
            { key: "rising", rotation: Math.PI / 4 },
            { key: "falling", rotation: -Math.PI / 4 },
          ].map((arm) => (
            <group key={arm.key}>
              <mesh position={[0, 0, -0.001]} rotation={[0, 0, arm.rotation]}>
                <planeGeometry args={[VOLCANO_STROKE_LENGTH, STROKE_ARM_THICKNESS]} />
                <meshBasicMaterial color="#05070d" side={DoubleSide} transparent opacity={0.95} />
              </mesh>
              <mesh rotation={[0, 0, arm.rotation]}>
                <planeGeometry args={[VOLCANO_ARM_LENGTH, ARM_THICKNESS]} />
                <meshBasicMaterial color={color} side={DoubleSide} transparent opacity={opacity} />
              </mesh>
            </group>
          ))
        : [
            { key: "left", position: [-ARM_OFFSET, 0, 0], rotation: 0 },
            { key: "right", position: [ARM_OFFSET, 0, 0], rotation: 0 },
            { key: "top", position: [0, ARM_OFFSET, 0], rotation: Math.PI / 2 },
            { key: "bottom", position: [0, -ARM_OFFSET, 0], rotation: Math.PI / 2 },
          ].map((arm) => (
            <group key={arm.key}>
              <mesh
                position={[arm.position[0], arm.position[1], -0.001]}
                rotation={[0, 0, arm.rotation]}
              >
                <planeGeometry args={[STROKE_ARM_LENGTH, STROKE_ARM_THICKNESS]} />
                <meshBasicMaterial color="#05070d" side={DoubleSide} transparent opacity={0.95} />
              </mesh>
              <mesh position={arm.position as [number, number, number]} rotation={[0, 0, arm.rotation]}>
                <planeGeometry args={[ARM_LENGTH, ARM_THICKNESS]} />
                <meshBasicMaterial color={color} side={DoubleSide} transparent opacity={opacity} />
              </mesh>
            </group>
          ))}
    </Billboard>
  );
}
