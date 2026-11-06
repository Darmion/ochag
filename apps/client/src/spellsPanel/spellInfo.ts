import type { SrdSpell } from '../rules/srd';
import type { SpellMechanicsView } from '../spells/spellMechanics';
import { SCHOOL_LABELS, componentsRu, spellTextRu } from '../spells/spellText';
import type { CampaignSpell } from './types';
import type { GameIconName } from '../ui/gameIcons';

const SCHOOL_ICONS: Record<string, GameIconName> = {
  Abjuration: 'shield', Conjuration: 'summon', Divination: 'orb', Enchantment: 'spiral',
  Evocation: 'flame', Illusion: 'mask', Necromancy: 'skull', Transmutation: 'flask',
};
export function schoolIcon(school: string): GameIconName {
  return SCHOOL_ICONS[school] ?? 'sparkle';
}

export const schoolLabel = (school: string) => SCHOOL_LABELS[school] ?? school;

export function spellFacts(spell: SrdSpell | CampaignSpell): Array<{ icon: GameIconName; text: string }> {
  const facts: Array<{ icon: GameIconName; text: string } | null> = [
    spell.castingTime ? { icon: 'clock', text: spellTextRu(spell.castingTime) } : null,
    spell.range ? { icon: 'dash', text: spellTextRu(spell.range) } : null,
    spell.duration ? { icon: 'hourglass', text: `${spell.concentration ? 'концентрация, ' : ''}${spellTextRu(spell.duration).toLowerCase()}` } : null,
    spell.components ? { icon: 'hand', text: `${componentsRu(spell.components)}${spell.ritual ? ' · ритуал' : ''}` } : null,
  ];
  return facts.filter(fact => fact !== null);
}

export const STATUS_LABEL: Record<CampaignSpell['status'], string> = {
  draft: 'черновик', pending: 'на рассмотрении', approved: 'одобрено', rejected: 'отклонено', rework: 'на доработке',
};

export function spellName(spell: SrdSpell | CampaignSpell | null): string {
  if (!spell) return '(заклинание удалено)';
  return 'nameRu' in spell ? (spell.nameRu ?? spell.name) : spell.name;
}

export function spellDesc(spell: SrdSpell | CampaignSpell): string {
  return 'descRu' in spell ? (spell.descRu ?? spell.desc) : spell.desc;
}

export function spellHigherLevel(spell: SrdSpell | CampaignSpell): string | null {
  return 'higherLevelRu' in spell ? (spell.higherLevelRu ?? spell.higherLevel) : spell.higherLevel;
}

export function mechanicsOf(spell: SrdSpell | CampaignSpell | null): SpellMechanicsView | null {
  return (spell as any)?.mechanics ?? null;
}
