export type CheckKind = 'skill' | 'save' | 'ability';
export type Sense = '' | 'sight' | 'hearing';
export type CheckView = { kind: CheckKind; tabs: boolean; heading: string | null; sense: boolean };

export function checkView(popover: string | null, tab: CheckKind): CheckView {
  if (popover === 'checks') return { kind: tab, tabs: true, heading: null, sense: tab !== 'save' };
  if (popover === 'skill') return { kind: 'skill', tabs: false, heading: 'Навык', sense: true };
  if (popover === 'save') return { kind: 'save', tabs: false, heading: 'Спасбросок', sense: false };
  return { kind: 'ability', tabs: false, heading: 'Проверка характеристики', sense: popover === 'ability' };
}

export function peerlessNote(feature: { detail: string; resource: { current: number; max: number } | null }) {
  const die = feature.detail.split(' ')[0];
  return feature.resource ? `${die} к броску (вдохновение ${feature.resource.current}/${feature.resource.max})` : `${die} к броску`;
}
