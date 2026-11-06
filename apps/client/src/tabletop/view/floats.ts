import { ref, type Ref } from 'vue';
import type { Tabletop } from '../scene';
import type { LiveExperience, LiveHp } from '../live';
import { playSfx } from '../sfx';
import type { TabletopProps, SceneObjectDTO } from './types';
import type { TableToast } from '../toasts';

export type FloatsDeps = {
  props: TabletopProps;
  objects: Ref<SceneObjectDTO[]>;
  table: () => Tabletop | undefined;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function useFloats({ props, objects, table, pushToast, run }: FloatsDeps) {
  const questsRevision = ref(0);

  function showExperience(event: LiveExperience) {
    for (const award of event.awards) {
      for (const placement of objects.value.filter(object => object.character_id === award.characterId)) {
        table()?.showFloatingText(placement.id, `+${award.amount} опыта`, 'xp');
        if (award.leveledUp) setTimeout(() => table()?.showFloatingText(placement.id, `Уровень ${award.level}!`, 'level'), 650);
      }
    }
    const shares = [...new Set(event.awards.map(award => award.amount))];
    pushToast({
      tone: 'info', title: 'Опыт',
      detail: `${event.reason}: ${event.awards.map(award => award.name).join(', ')} — по ${shares.join('/')}.`,
    }, 7000);
    for (const award of event.awards) {
      if (award.leveledUp) {
        pushToast({ tone: 'crit', title: 'Новый уровень!', value: award.name, detail: `${award.level}-й уровень${award.hpGain ? ` · хиты +${award.hpGain}` : ''}` }, 10000);
        playSfx('level');
      } else if (award.readyLevel) {
        pushToast({ tone: 'mine', title: 'Новый уровень!', value: award.name, detail: `Опыта хватает на ${award.readyLevel}-й уровень — откройте лист и нажмите «Новый уровень!»: хиты, улучшения, заклинания.` }, 12000);
      }
    }
  }

  function awardParty(amount: number) {
    const ids = [...new Set(objects.value.filter(object => object.kind === 'character').map(object => object.character_id))];
    if (!ids.length || amount <= 0) return;
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/experience`, 'POST', { characterIds: ids, amount, split: true, reason: 'Награда отряду' });
    });
  }

  function showHpFloat(event: LiveHp) {
    const placements = objects.value.filter(object => object.character_id === event.characterId);
    const board = table();
    if (!placements.length || !board) return;
    let text: string;
    let tone: 'damage' | 'heal' | 'miss' | 'crit' | 'info';
    if (event.mode === 'miss') {
      text = 'промах';
      tone = 'miss';
    } else if (event.blocked === 'immune') {
      text = 'иммунитет';
      tone = 'info';
    } else if (event.blocked === 'threshold') {
      text = 'не пробито';
      tone = 'info';
    } else if (event.blocked === 'dead') {
      text = 'мёртв';
      tone = 'info';
    } else if (event.blocked === 'no_healing') {
      text = 'не лечится';
      tone = 'info';
    } else if (event.mode === 'heal') {
      text = `+${event.amount}`;
      tone = 'heal';
    } else {
      text = `−${event.amount}${event.critical ? ' крит!' : ''}${event.modified === 'resisted' ? ' ½' : event.modified === 'vulnerable' ? ' ×2' : ''}`;
      tone = event.critical ? 'crit' : 'damage';
    }
    for (const placement of placements) board.showFloatingText(placement.id, text, tone);
  }

  return { questsRevision, showExperience, awardParty, showHpFloat };
}
