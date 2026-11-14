import { findSrdSpell, srdSpellName } from '../rules/srd-data.ts';
import { SRD_MAGIC_ITEMS, type SrdMagicItem } from '../../../../packages/domain/character/magic-items.ts';
import { magicBaseOptions } from '../../../../packages/domain/character/magic-item-base.ts';

// The SRD list the GM gives from, with what magic weapons, armor and shields can be made of.
export function srdMagicItemList() {
  const weapon = SRD_MAGIC_ITEMS.find(item => item.kind === 'weapon');
  const armor = SRD_MAGIC_ITEMS.find(item => item.kind === 'armor' && !/щит/i.test(item.kindText));
  const shield = SRD_MAGIC_ITEMS.find(item => item.kind === 'armor' && /щит/i.test(item.kindText));
  return {
    items: SRD_MAGIC_ITEMS,
    bases: { weapon: weapon ? magicBaseOptions(weapon) : [], armor: armor ? magicBaseOptions(armor) : [], shield: shield ? magicBaseOptions(shield) : [] },
    attribution: 'System Reference Document 5.1, Wizards of the Coast, CC-BY-4.0',
  };
}

// A spell scroll holds one spell of its level, chosen by the GM; other items take no spell.
export function scrollSpell(item: SrdMagicItem, spell: string | null | undefined): { index: string; name: string } | string | null {
  if (item.use?.kind !== 'scroll') return spell ? `«${item.nameRu}» — не свиток: заклинание на него не записать.` : null;
  if (!spell) return `Выберите, какое заклинание записано на «${item.nameRu}».`;
  const found = findSrdSpell(spell);
  if (!found) return 'Такого заклинания в SRD нет.';
  if (found.level !== item.use.level) {
    return `На «${item.nameRu}» пишут заклинание ${item.use.level ? `${item.use.level} круга` : 'уровня заговора'}, а «${srdSpellName(spell)}» — ${found.level ? `${found.level} круга` : 'заговор'}.`;
  }
  return { index: found.index, name: srdSpellName(spell) };
}
