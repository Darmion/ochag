export type Hazard = {
  types: string[]; radiusFeet: number; formula: string; damageType: string;
  save: string | null; dc: number | null; halfOnSuccess: boolean; message: string | null;
};

export const HAZARD_PRESETS: Array<{ label: string; hazard: Hazard }> = [
  { label: 'Бочка с маслом', hazard: { types: ['fire'], radiusFeet: 10, formula: '4d6', damageType: 'fire', save: 'dexterity', dc: 12, halfOnSuccess: true, message: 'Масло вспыхивает!' } },
  { label: 'Бочонок пороха', hazard: { types: ['fire', 'lightning'], radiusFeet: 15, formula: '6d6', damageType: 'fire', save: 'dexterity', dc: 13, halfOnSuccess: true, message: 'Грохот взрыва!' } },
  { label: 'Склянка кислоты', hazard: { types: [], radiusFeet: 5, formula: '2d6', damageType: 'acid', save: 'dexterity', dc: 11, halfOnSuccess: true, message: 'Кислота разлетается брызгами.' } },
  { label: 'Подпиленная колонна', hazard: { types: ['bludgeoning', 'force', 'thunder'], radiusFeet: 10, formula: '3d10', damageType: 'bludgeoning', save: 'dexterity', dc: 14, halfOnSuccess: true, message: 'Колонна рушится!' } },
];

export type ObjectPreset = {
  id: string; label: string; art: string | null; size: 'tiny' | 'small' | 'medium' | 'large';
  material: 'cloth' | 'glass' | 'wood' | 'stone' | 'iron'; durability: 'fragile' | 'resilient';
  openable?: boolean; hazard?: Hazard;
};

const hazard = (label: string) => HAZARD_PRESETS.find(entry => entry.label === label)!.hazard;

export const OBJECT_PRESETS: ObjectPreset[] = [
  { id: 'chest', label: 'Сундук', art: 'scene/containers/chests/chest-wooden-closed', size: 'small', material: 'wood', durability: 'resilient', openable: true },
  { id: 'oil', label: 'Бочка с маслом', art: 'scene/containers/barrel-flammable', size: 'small', material: 'wood', durability: 'resilient', hazard: hazard('Бочка с маслом') },
  { id: 'powder', label: 'Бочонок пороха', art: 'scene/containers/barrel', size: 'small', material: 'wood', durability: 'resilient', hazard: hazard('Бочонок пороха') },
  { id: 'acid', label: 'Склянка кислоты', art: 'items/potions/green-flask', size: 'tiny', material: 'glass', durability: 'fragile', hazard: hazard('Склянка кислоты') },
  { id: 'column', label: 'Подпиленная колонна', art: null, size: 'medium', material: 'stone', durability: 'resilient', hazard: hazard('Подпиленная колонна') },
];

export const presetById = (id: string) => OBJECT_PRESETS.find(entry => entry.id === id) ?? null;
