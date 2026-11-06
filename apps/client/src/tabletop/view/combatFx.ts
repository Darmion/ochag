import { ref, type Ref } from 'vue';
import type { Tabletop } from '../scene';
import type { LiveAttack } from '../live';
import { playSfx, spellSfxEvent } from '../sfx';
import type { CombatSummaryData } from '../../components/tabletop/CombatSummary.vue';
import type { TabletopProps, SceneObjectDTO } from './types';
import type { TableToast } from '../toasts';

export type CombatFxDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  objects: Ref<SceneObjectDTO[]>;
  table: () => Tabletop | undefined;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function useCombatFx({ props, sceneId, objects, table, pushToast, run }: CombatFxDeps) {
  const combatSummary = ref<CombatSummaryData | null>(null);

  function openCombatSummary() {
    if (!sceneId.value) return;
    return run(async () => {
      const { summary } = await props.request(`/campaigns/${props.campaignId}/scenes/${sceneId.value}/combat-summary`);
      if (summary) combatSummary.value = summary;
      else pushToast({ tone: 'info', title: 'Итоги боя', detail: 'На этой сцене боя ещё не было.' });
    });
  }

  function showAttackFx(event: LiveAttack) {
    if (event.sceneId !== sceneId.value) return;
    const from = objects.value.find(object => object.character_id === event.attackerId && !object.parent_object_id);
    const to = objects.value.find(object => object.character_id === event.targetId && !object.parent_object_id);
    if (from && to) table()?.showAttack(from.id, to.id, event.source === 'spell' ? 'spell' : event.ranged ? 'arrow' : 'melee', event.effect);
    playAttackSounds(event);
  }

  const lastSpellSound = new Map<string, number>();
  function playAttackSounds(event: LiveAttack) {
    if (event.source === 'spell' || event.effect === 'heal') {
      const now = performance.now();
      const fresh = now - (lastSpellSound.get(event.attackerId) ?? -Infinity) > 600;
      lastSpellSound.set(event.attackerId, now);
      if (event.effect === 'heal') {
        if (fresh) playSfx('heal', { delayMs: 380 });
        return;
      }
      if (fresh) playSfx(spellSfxEvent(event.damageType), { delayMs: 380, shape: event.area ?? null });
      if (event.effect === 'crit') playSfx('crit', { delayMs: 420 });
      else if (event.effect === 'miss' && !event.area) playSfx('spell-miss', { delayMs: 650 });
      return;
    }
    const delayMs = event.ranged ? 380 : 200;
    playSfx(event.ranged ? 'ranged-shot' : 'melee-swing');
    const missed = event.effect === 'miss';
    playSfx(event.ranged ? (missed ? 'ranged-miss' : 'ranged-hit') : missed ? 'melee-miss' : 'melee-hit', { delayMs });
    if (event.effect === 'crit') playSfx('crit', { delayMs: delayMs + 40 });
  }

  return { combatSummary, openCombatSummary, showAttackFx };
}
