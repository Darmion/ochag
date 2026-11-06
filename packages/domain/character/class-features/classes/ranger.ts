import { knownChoices } from '../internal.ts';

export const HUNTERS_PREY = [
  { id: 'colossus-slayer', nameRu: 'Убийца колоссов', pattern: /Убийц\S* колоссов|Colossus Slayer/i },
  { id: 'giant-killer', nameRu: 'Убийца великанов', pattern: /Убийц\S* великанов|Giant Killer/i },
  { id: 'horde-breaker', nameRu: 'Сокрушитель орд', pattern: /Сокрушител\S* орд|Horde Breaker/i },
] as const;

export function knownHuntersPrey(sheetExtra: any): string[] {
  return knownChoices(sheetExtra, 'huntersPrey', HUNTERS_PREY).slice(0, 1);
}

export const DEFENSIVE_TACTICS = [
  { id: 'escape-the-horde', nameRu: 'Уйти от толпы', text: 'Атаки при уходе по вам — с помехой.' },
  { id: 'multiattack-defense', nameRu: 'Защита от мультиатаки', text: 'Существо попало по вам — до конца хода его следующие атаки по вам против КД +4.' },
  { id: 'steel-will', nameRu: 'Стальная воля', text: 'Спасброски против испуга — с преимуществом.' },
] as const;

export const HUNTER_MULTIATTACK = [
  { id: 'volley', nameRu: 'Залп', text: 'Действием — дальнобойная атака по каждому существу в 10 футах от точки, своим броском каждому.' },
  { id: 'whirlwind', nameRu: 'Вихрь', text: 'Действием — рукопашная атака по каждому существу в 5 футах от вас, своим броском каждому.' },
] as const;

export function knownDefensiveTactics(sheetExtra: any): string[] {
  const list = Array.isArray(sheetExtra?.defensiveTactics) ? sheetExtra.defensiveTactics.map(String) : [];
  return list.filter((id: string) => DEFENSIVE_TACTICS.some(entry => entry.id === id)).slice(0, 1);
}

export function knownHunterMultiattack(sheetExtra: any): string[] {
  const list = Array.isArray(sheetExtra?.hunterMultiattack) ? sheetExtra.hunterMultiattack.map(String) : [];
  return list.filter((id: string) => HUNTER_MULTIATTACK.some(entry => entry.id === id)).slice(0, 1);
}

export const SUPERIOR_HUNTERS_DEFENSE = [
  { id: 'evasion', nameRu: 'Увёртливость', text: 'Спасбросок Ловкости «половина при успехе»: успех — без урона, провал — половина.' },
  { id: 'stand-against-the-tide', nameRu: 'Против течения', text: 'Враг промахнулся по вам рукопашной — реакцией он повторяет ту же атаку по своему соседу (вашему врагу).' },
  { id: 'uncanny-dodge', nameRu: 'Невероятное уклонение', text: 'Попал атакующий, которого вы видите, — реакцией урон вдвое меньше.' },
] as const;

export function knownSuperiorDefense(sheetExtra: any): string[] {
  const list = Array.isArray(sheetExtra?.superiorDefense) ? sheetExtra.superiorDefense.map(String) : [];
  return list.filter((id: string) => SUPERIOR_HUNTERS_DEFENSE.some(entry => entry.id === id)).slice(0, 1);
}

export function favoredEnemyLimit(rangerLevel: number): number {
  return rangerLevel >= 14 ? 3 : rangerLevel >= 6 ? 2 : rangerLevel >= 1 ? 1 : 0;
}

export const FAVORED_ENEMY_TYPES = [
  'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'monstrosity', 'ooze', 'plant', 'undead', 'humanoid',
] as const;

export function knownFavoredEnemies(sheetExtra: any): string[] {
  const list = Array.isArray(sheetExtra?.favoredEnemies) ? sheetExtra.favoredEnemies.map(String) : [];
  return list.filter((id: string) => (FAVORED_ENEMY_TYPES as readonly string[]).includes(id));
}

export const VOLLEY_SPREAD_FEET = 20;
