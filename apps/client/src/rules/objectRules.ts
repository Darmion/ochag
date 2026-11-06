import type { CreatureSize } from '../campaign/objects';

export type Material = 'cloth' | 'glass' | 'wood' | 'stone' | 'iron' | 'mithral' | 'adamantine';
export type Durability = 'fragile' | 'resilient';

export const MATERIALS: Array<{ id: Material; label: string; ac: number }> = [
  { id: 'cloth', label: 'Ткань, бумага, верёвка', ac: 11 },
  { id: 'glass', label: 'Хрусталь, стекло, лёд', ac: 13 },
  { id: 'wood', label: 'Дерево, кость', ac: 15 },
  { id: 'stone', label: 'Камень', ac: 17 },
  { id: 'iron', label: 'Железо, сталь', ac: 19 },
  { id: 'mithral', label: 'Мифрил', ac: 21 },
  { id: 'adamantine', label: 'Адамантин', ac: 23 },
];

const HIT_POINTS: Record<'tiny' | 'small' | 'medium' | 'large', { fragile: [number, string]; resilient: [number, string] }> = {
  tiny: { fragile: [2, '1d4'], resilient: [5, '2d4'] },
  small: { fragile: [3, '1d6'], resilient: [10, '3d6'] },
  medium: { fragile: [4, '1d8'], resilient: [18, '4d8'] },
  large: { fragile: [5, '1d10'], resilient: [27, '5d10'] },
};

export function objectHint(material: Material, size: CreatureSize, durability: Durability) {
  const ac = MATERIALS.find(entry => entry.id === material)?.ac ?? 15;
  const bySize = size === 'huge' || size === 'gargantuan' ? 'large' : size;
  const [hp, dice] = HIT_POINTS[bySize][durability];
  const perSection = bySize !== size;
  return {
    ac,
    hp,
    text: `КД ${ac}, хиты ${hp} (${dice})${perSection ? ' на каждую часть 10×10 фут.' : ''}. Иммунитет к яду и психической энергии.`,
  };
}

export const DAMAGE_TYPES: Array<{ id: string; label: string }> = [
  { id: 'acid', label: 'кислота' },
  { id: 'bludgeoning', label: 'дробящий' },
  { id: 'cold', label: 'холод' },
  { id: 'fire', label: 'огонь' },
  { id: 'force', label: 'силовое поле' },
  { id: 'lightning', label: 'электричество' },
  { id: 'necrotic', label: 'некротическая энергия' },
  { id: 'piercing', label: 'колющий' },
  { id: 'poison', label: 'яд' },
  { id: 'psychic', label: 'психическая энергия' },
  { id: 'radiant', label: 'излучение' },
  { id: 'slashing', label: 'рубящий' },
  { id: 'thunder', label: 'звук' },
];
