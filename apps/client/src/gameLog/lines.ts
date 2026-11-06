import { computed } from 'vue';
import { describeGroups } from '../rules/dice';
import { outcomeText } from '../rules/conditions';
import { naturalMark } from '../tabletop/toasts';
import { t } from '../i18n/i18n';
import type { GameLogProps } from './types';

export type LogLinesDeps = {
  props: GameLogProps;
};

export function useLogLines({ props }: LogLinesDeps) {
  function withoutName(label: string | null | undefined, who: string | null) {
    if (!label || !who) return label ?? '';
    const trimmed = label.replace(` — ${who}`, '');
    return trimmed.endsWith(`: ${who}`) ? trimmed.slice(0, -(who.length + 2)) : trimmed;
  }

  const rollLines = computed(() => [...props.rolls].reverse().slice(-80).map(roll => {
    const who = roll.character_id ? props.characterNames[roll.character_id] ?? null : null;
    const author = roll.user_id === props.currentUserId ? 'Вы' : roll.user_display_name ?? 'Участник';
    const mark = naturalMark(roll);
    return {
      id: roll.id,
      who,
      author,
      mine: roll.user_id === props.currentUserId,
      label: withoutName(roll.label, who) || roll.formula,
      formula: roll.formula,
      detail: roll.breakdown?.length ? describeGroups(roll.breakdown) : roll.dice_results.join(', '),
      total: mark ? mark.text : String(roll.total),
      fullTotal: mark?.total ?? null,
      hidden: roll.hidden,
      natural: mark?.kind ?? (roll.outcome?.critical ? 'crit' : ''),
      result: outcomeText(roll.outcome),
      good: Boolean(roll.outcome?.hit || roll.outcome?.success || roll.outcome?.result === 'revived' || roll.outcome?.result === 'stable' || roll.outcome?.result === 'success'),
      reasons: roll.outcome?.reasons?.join('; ') ?? '',
      time: new Date(roll.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      at: roll.created_at,
      kind: 'roll' as const,
      applied: roll.applied_to ?? [],
    };
  }));

  const chatLines = computed(() => (props.chat ?? []).slice(-80).map(message => ({
    id: message.id,
    kind: 'chat' as const,
    at: message.created_at,
    time: new Date(message.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    who: message.in_character && message.character_name ? message.character_name : message.user_id === props.currentUserId ? t('Вы') : message.user_name,
    author: message.in_character ? (message.user_id === props.currentUserId ? t('Вы') : message.user_name) : null,
    mine: message.user_id === props.currentUserId,
    inCharacter: message.in_character,
    whisper: message.to_user_id ? (message.user_id === props.currentUserId ? `шёпот → ${message.to_user_name ?? 'участнику'}` : 'шепчет вам') : '',
    body: message.body,
  })));

  const lines = computed(() => [...rollLines.value, ...chatLines.value].sort((a, b) => a.at.localeCompare(b.at)).slice(-120));

  return { rollLines, lines };
}
