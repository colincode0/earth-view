import { Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { DoubleSide, type Group } from "three";

type ActivityCrosshairProps = {
  color: string;
  opacity?: number;
  position: [number, number, number];
  sizeMultiplier?: number;
};

const MIN_SIZE = 0.004;
const MAX_SIZE = 0.05;
const DISTANCE_SCALE = 0.018;
const ARM_LENGTH = 0.72;
const ARM_THICKNESS = 0.1;
const ARM_OFFSET = 0.46;

export function ActivityCrosshair({
  color,
  opacity = 0.95,
  position,
  sizeMultiplier = 1,
}: ActivityCrosshairProps) {
  const groupRef = useRef<Group>(null);

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

  return (
    <Billboard ref={groupRef} position={position}>
      {[
        { key: "left", position: [-ARM_OFFSET, 0, 0], rotation: 0 },
        { key: "right", position: [ARM_OFFSET, 0, 0], rotation: 0 },
        { key: "top", position: [0, ARM_OFFSET, 0], rotation: Math.PI / 2 },
        { key: "bottom", position: [0, -ARM_OFFSET, 0], rotation: Math.PI / 2 },
      ].map((arm) => (
        <mesh
          key={arm.key}
          position={arm.position as [number, number, number]}
          rotation={[0, 0, arm.rotation]}
        >
          <planeGeometry args={[ARM_LENGTH, ARM_THICKNESS]} />
          <meshBasicMaterial color={color} side={DoubleSide} transparent opacity={opacity} />
        </mesh>
      ))}
    </Billboard>
  );
}
