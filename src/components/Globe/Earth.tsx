import { ThreeEvent, useLoader, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from "three";
import { pointToLatLon } from "@/lib/geo";
import { BoundaryLines } from "./BoundaryLines";

type EarthProps = {
  textureUrl: string;
  onSelect: (lat: number, lon: number) => void;
};

export function Earth({ textureUrl, onSelect }: EarthProps) {
  const { gl } = useThree();
  const texture = useLoader(TextureLoader, textureUrl, (loader) => {
    loader.setCrossOrigin("anonymous");
  });

  useEffect(() => {
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.offset.x = 0.5;
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
  }, [gl, texture]);

  function selectEventPoint(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();

    const point = new Vector3().copy(event.point).normalize();
    const { lat, lon } = pointToLatLon(point);
    onSelect(lat, lon);
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!event.nativeEvent.shiftKey) {
      return;
    }

    selectEventPoint(event);
  }

  function handleContextMenu(event: ThreeEvent<MouseEvent>) {
    event.nativeEvent.preventDefault();
    selectEventPoint(event);
  }

  return (
    <group>
      <mesh onClick={handleClick} onContextMenu={handleContextMenu} castShadow receiveShadow>
        <sphereGeometry args={[1, 128, 128]} />
        <meshStandardMaterial
          map={texture}
          color="#b7c8cb"
          emissive="#071115"
          emissiveIntensity={0.35}
          roughness={0.9}
          metalness={0}
        />
      </mesh>
      <BoundaryLines />
    </group>
  );
}
