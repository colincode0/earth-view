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

type CachedGlobeTexture = {
  texture?: Texture;
  promise?: Promise<Texture>;
  refs: number;
  lastUsed: number;
};

const MAX_BACKGROUND_GLOBE_TEXTURES = 2;
const backgroundGlobeTextureCache = new Map<string, CachedGlobeTexture>();

function prepareGlobeTexture(texture: Texture, maxAnisotropy: number) {
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.offset.x = 0.5;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
}

function getBackgroundGlobeTextureEntry(url: string) {
  let entry = backgroundGlobeTextureCache.get(url);

  if (!entry) {
    entry = { refs: 0, lastUsed: Date.now() };
    backgroundGlobeTextureCache.set(url, entry);
  }

  entry.lastUsed = Date.now();
  return entry;
}

function pruneBackgroundGlobeTextureCache() {
  const evictableEntries = [...backgroundGlobeTextureCache.entries()]
    .filter(([, entry]) => entry.refs === 0 && entry.texture)
    .sort(([, a], [, b]) => a.lastUsed - b.lastUsed);

  while (backgroundGlobeTextureCache.size > MAX_BACKGROUND_GLOBE_TEXTURES) {
    const evictable = evictableEntries.shift();

    if (!evictable) {
      return;
    }

    const [url, entry] = evictable;
    entry.texture?.dispose();
    backgroundGlobeTextureCache.delete(url);
  }
}

function retainBackgroundGlobeTexture(url: string) {
  const entry = getBackgroundGlobeTextureEntry(url);
  entry.refs += 1;

  return () => {
    const retainedEntry = backgroundGlobeTextureCache.get(url);

    if (!retainedEntry) {
      return;
    }

    retainedEntry.refs = Math.max(0, retainedEntry.refs - 1);
    retainedEntry.lastUsed = Date.now();
    pruneBackgroundGlobeTextureCache();
  };
}

function loadBackgroundGlobeTexture(url: string, maxAnisotropy: number) {
  const entry = getBackgroundGlobeTextureEntry(url);

  if (entry.texture) {
    prepareGlobeTexture(entry.texture, maxAnisotropy);
    return Promise.resolve(entry.texture);
  }

  if (entry.promise) {
    return entry.promise;
  }

  const loader = new TextureLoader();

  loader.setCrossOrigin("anonymous");
  entry.promise = new Promise<Texture>((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        prepareGlobeTexture(texture, maxAnisotropy);
        entry.texture = texture;
        entry.promise = undefined;
        entry.lastUsed = Date.now();
        pruneBackgroundGlobeTextureCache();
        resolve(texture);
      },
      undefined,
      (error) => {
        entry.promise = undefined;
        backgroundGlobeTextureCache.delete(url);
        reject(error);
      },
    );
  });

  return entry.promise;
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
    const releaseTexture = retainBackgroundGlobeTexture(textureUrl);

    setLoadedTexture(null);
    loadBackgroundGlobeTexture(textureUrl, gl.capabilities.getMaxAnisotropy())
      .then((texture) => {
        if (!cancelled) {
          setLoadedTexture({ texture, url: textureUrl });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedTexture(null);
        }
      });

    return () => {
      cancelled = true;
      releaseTexture();
    };
  }, [enabled, gl, textureUrl]);

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
