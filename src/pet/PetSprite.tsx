import { useEffect, useState } from 'react';
import {
  PET_ATLAS,
  type PetAnimationId,
  getPetAnimation,
  getPetFrameAtTime,
  getPetFrameOffset,
  getPetRenderScale,
  getPetSpriteSize,
} from './animation';
import { getPetSpritesheetUrl, type PetCatalogItem } from './catalog';

export function PetSprite({
  animationId,
  pet,
  scale,
  reducedMotion,
}: {
  animationId: PetAnimationId;
  pet: PetCatalogItem;
  scale: number;
  reducedMotion: boolean;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const animation = getPetAnimation(reducedMotion ? 'idle' : animationId);
  const animationKey = `${pet.id}:${animationId}`;
  const frame = reducedMotion ? 0 : getPetFrameAtTime(animation, elapsedMs);
  const renderScale = getPetRenderScale(scale);
  const offset = getPetFrameOffset(animation, frame, scale);
  const size = getPetSpriteSize(scale);

  useEffect(() => {
    if (reducedMotion) {
      setElapsedMs(0);
      return;
    }

    let frameId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setElapsedMs(now - start);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [animationKey, reducedMotion]);

  return (
    <div
      aria-label={`${pet.displayName} desktop pet`}
      role="img"
      className="pet-sprite"
      style={{
        width: size.width,
        height: size.height,
        backgroundImage: `url("${getPetSpritesheetUrl(pet)}")`,
        backgroundSize: `${PET_ATLAS.width * renderScale}px ${PET_ATLAS.height * renderScale}px`,
        backgroundPosition: `${offset.x}px ${offset.y}px`,
      }}
    />
  );
}
