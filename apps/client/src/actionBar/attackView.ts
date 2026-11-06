import type { AttackOptions } from './attackTypes.ts';

export type AttackUsing = 'action' | 'bonus' | 'reaction';
export type AttackUsingView = { options: Array<{ value: AttackUsing; label: string; disabled: boolean }>; note: string };

export type AttackUsingInput = {
  economy: { bonus: boolean; reaction: boolean };
  isActorTurn: boolean;
  options: AttackOptions | null;
  bonusAllowed: boolean;
  reactionAllowed: boolean;
  bonusHint: string;
};

const BONUS_NOTE = 'Бонусным — второе лёгкое оружие после атаки лёгким или умение. ';
const REACTION_NOTE = 'Реакцией — при уходе цели (предложение появится само) или «Подготовиться» в «Действиях».';

export function attackUsingView({ economy, isActorTurn, options, bonusAllowed, reactionAllowed, bonusHint }: AttackUsingInput): AttackUsingView {
  const readied = options?.readied;
  const bonusTail = bonusHint ? ` — ${bonusHint}` : bonusAllowed ? '' : ' — нечем';
  const reactionTail = readied ? ` — подготовленная${readied.trigger ? `: ${readied.trigger}` : ''}` : reactionAllowed ? '' : ' — не подготовлена';
  const limited = Boolean(options?.enforced) && (!bonusAllowed || !reactionAllowed);
  return {
    options: [
      { value: 'action', label: 'действием «Атака»', disabled: !isActorTurn },
      { value: 'bonus', label: `бонусным действием${bonusTail}`, disabled: !isActorTurn || !economy.bonus || !bonusAllowed },
      { value: 'reaction', label: `реакцией${reactionTail}`, disabled: !economy.reaction || !reactionAllowed },
    ],
    note: limited ? (bonusAllowed ? '' : BONUS_NOTE) + (reactionAllowed ? '' : REACTION_NOTE) : '',
  };
}
