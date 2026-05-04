export const PET_CATALOG = [
  {
    id: 'nia',
    displayName: 'Nia',
    description: 'A larger elf-eared blonde Nia pet with independently generated action animations.',
    spritesheetPath: 'spritesheet.webp',
    spritesheetUrl: '/pets/nia/spritesheet.webp',
    imported: false,
  },
] as const;

export type PetCatalogItem = {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  spritesheetUrl: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  imported: boolean;
};

export type PetId = string;

export function isPetId(
  value: string,
  catalog: readonly PetCatalogItem[] = PET_CATALOG,
): value is PetId {
  return catalog.some((pet) => pet.id === value);
}

export function getCatalogPet(
  id: PetId,
  catalog: readonly PetCatalogItem[] = PET_CATALOG,
): PetCatalogItem {
  return catalog.find((pet) => pet.id === id) ?? catalog[0] ?? PET_CATALOG[0];
}

export function getPetSpritesheetUrl(pet: PetCatalogItem): string {
  return pet.spritesheetUrl || `/pets/${pet.id}/${pet.spritesheetPath}`;
}
