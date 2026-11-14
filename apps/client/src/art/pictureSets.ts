import { artLibraryGroups } from './artPacks';
import { artHas } from './artSource';

export type PictureSet = { id: string; label: string; paths: string[] };

// Picture sets for map objects (trees, rocks, crates): a random one each, for a natural-looking group.
export async function pictureSets(): Promise<PictureSet[]> {
  return (await artLibraryGroups())
    .filter(group => group.id.startsWith('scene/'))
    .map(group => ({ id: group.id, label: group.label, paths: group.items.map(item => item.path).filter(artHas) }))
    .filter(set => set.paths.length > 1);
}
