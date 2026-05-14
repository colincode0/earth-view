import { ThreeEvent, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import { RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader, Vector3 } from "three";
import { pointToLatLon } from "@/lib/geo";

type OverlayTexture = { id: string; url: string };

type EarthProps = {
  imageryVisible: boolean;
  textureUrl: string;
  upgradeTextureUrl?: string;
  overlayTextures?: OverlayTexture[];
  overlayOpacity?: number;
  onSelect: (lat: number, lon: number) => void;
  onReady?: (textureUrl: string) => void;
};

type SelectHandlers = {
  onSelect: (lat: number, lon: number) => void;
};

function prepareGlobeTexture(texture: Texture, maxAnisotropy: number) {
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.offset.x = 0.5;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
}

function useGlobeTexture(textureUrl: string) {
  const { gl } = useThree();
  const texture = useLoader(TextureLoader, textureUrl, (loader) => {
    loader.setCrossOrigin("anonymous");
  });

  useEffect(() => {
    prepareGlobeTexture(texture, gl.capabilities.getMaxAnisotropy());
  }, [gl, texture]);

  return texture;
}

function useBackgroundGlobeTexture(textureUrl: string | undefined, enabled: boolean) {
  const { gl } = useThree();
  const [loadedTexture, setLoadedTexture] = useState<{
    texture: Texture;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!textureUrl || !enabled) {
      setLoadedTexture(null);
      return;
    }

    let cancelled = false;
    const loader = new TextureLoader();

    setLoadedTexture(null);
    loader.setCrossOrigin("anonymous");
    loader.load(
      textureUrl,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }

        prepareGlobeTexture(texture, gl.capabilities.getMaxAnisotropy());
        setLoadedTexture({ texture, url: textureUrl });
      },
      undefined,
      () => {
        if (!cancelled) {
          setLoadedTexture(null);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [enabled, gl, textureUrl]);

  useEffect(() => {
    return () => {
      loadedTexture?.texture.dispose();
    };
  }, [loadedTexture]);

  return loadedTexture;
}

function useGlobeClickHandlers({ onSelect }: SelectHandlers) {
  const selectedPointRef = useRef(new Vector3());

  function selectEventPoint(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    const point = selectedPointRef.current.copy(event.point).normalize();
    const { lat, lon } = pointToLatLon(point);
    onSelect(lat, lon);
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!event.nativeEvent.shiftKey) return;
    selectEventPoint(event);
  }

  function handleContextMenu(event: ThreeEvent<MouseEvent>) {
    event.nativeEvent.preventDefault();
    selectEventPoint(event);
  }

  return { handleClick, handleContextMenu };
}

function OverlaySphere({
  texture,
  opacity,
  renderOrder,
}: {
  texture: Texture;
  opacity: number;
  renderOrder: number;
}) {
  return (
    <mesh renderOrder={renderOrder}>
      <sphereGeometry args={[1.001, 128, 128]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function OverlayLayer({
  textureUrl,
  opacity,
  renderOrder,
}: {
  textureUrl: string;
  opacity: number;
  renderOrder: number;
}) {
  const texture = useGlobeTexture(textureUrl);
  return <OverlaySphere texture={texture} opacity={opacity} renderOrder={renderOrder} />;
}

export function PlaceholderEarth({ onSelect }: SelectHandlers) {
  const { handleClick, handleContextMenu } = useGlobeClickHandlers({ onSelect });

  return (
    <mesh onClick={handleClick} onContextMenu={handleContextMenu} castShadow receiveShadow>
      <sphereGeometry args={[1, 96, 96]} />
      <meshStandardMaterial
        color="#1c2a32"
        emissive="#071115"
        emissiveIntensity={0.35}
        roughness={0.95}
        metalness={0}
      />
    </mesh>
  );
}

export function Earth({
  imageryVisible,
  textureUrl,
  upgradeTextureUrl,
  overlayTextures,
  overlayOpacity = 0.75,
  onSelect,
  onReady,
}: EarthProps) {
  const baseTexture = useGlobeTexture(textureUrl);
  const upgradeTexture = useBackgroundGlobeTexture(upgradeTextureUrl, imageryVisible);
  const texture = upgradeTexture?.texture ?? baseTexture;
  const activeTextureUrl = upgradeTexture?.url ?? textureUrl;
  const { handleClick, handleContextMenu } = useGlobeClickHandlers({ onSelect });

  useEffect(() => {
    onReady?.(activeTextureUrl);
  }, [activeTextureUrl, onReady, texture]);

  return (
    <group>
      <mesh onClick={handleClick} onContextMenu={handleContextMenu}>
        <sphereGeometry args={[1, 128, 128]} />
        {imageryVisible ? (
          <meshBasicMaterial key="imagery" map={texture} />
        ) : (
          <meshBasicMaterial key="hidden-imagery" colorWrite={false} depthWrite />
        )}
      </mesh>
      {overlayTextures?.map((overlay, index) => (
        <Suspense key={overlay.id} fallback={null}>
          <OverlayLayer
            textureUrl={overlay.url}
            opacity={overlayOpacity}
            renderOrder={index + 1}
          />
        </Suspense>
      ))}
    </group>
  );
}
