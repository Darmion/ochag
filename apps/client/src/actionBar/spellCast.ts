import type { Ref } from 'vue';
import type { SpellEntry, ActionBarProps, HurlOffer, ActionBarEmit, PactSlots, SpellSlot, Metamagic } from './types';

export type SpellCastDeps = {
  props: ActionBarProps;
  emit: ActionBarEmit;
  pactSlots: Ref<PactSlots | null>;
  usePact: Ref<boolean>;
  useRacial: Ref<boolean>;
  useRitual: Ref<boolean>;
  useFree: Ref<boolean>;
  slotList: Ref<SpellSlot[]>;
  castSlot: Ref<number>;
  useInspiration: Ref<boolean>;
  castingEntry: Ref<SpellEntry | null>;
  hurlOffer: Ref<HurlOffer | null>;
  legacyOf: (entry: SpellEntry | null) => { index: string; name: string; minLevel: number; castAt: number; open: boolean; entryId: string | null; charge: { current: number; max: number; } | null; } | null;
  freeOf: (entry: SpellEntry | null) => { kind: "arcanum" | "mastery" | "signature"; label: string; } | null;
  castMetamagic: Ref<Metamagic>;
  castEmpowered: Ref<boolean>;
  castOverchannel: Ref<boolean>;
  overchannelReady: (entry: SpellEntry | null) => boolean;
  castHeightened: Ref<string>;
  perform: (action: () => Promise<unknown>, keepOpen?: boolean) => Promise<void>;
  sendFriendly: <T>(send: (warn: boolean) => Promise<T>) => Promise<T>;
  pactCastable: (entry: SpellEntry) => boolean;
  slotChoices: (entry: SpellEntry) => SpellSlot[];
  castBeast: Ref<string>;
  castElement: Ref<string>;
  castMode: Ref<string>;
  castTargets: Ref<string[]>;
  castArea: Ref<string>;
  shotsPer: Ref<Record<string, number>>;
  spellName: (entry: SpellEntry) => string;
};

export function useSpellCast({ props, emit, pactSlots, usePact, useRacial, useRitual, useFree, slotList, castSlot, useInspiration, castingEntry, hurlOffer, legacyOf, freeOf, castMetamagic, castEmpowered, castOverchannel, overchannelReady, castHeightened, perform, sendFriendly, pactCastable, slotChoices, castBeast, castElement, castMode, castTargets, castArea, shotsPer, spellName }: SpellCastDeps) {
  function cast(entry: SpellEntry, templateId = '', extra: Record<string, unknown> = {}): Promise<any> {
    const actor = props.actor;
    if (!actor) return Promise.resolve(null);
    const body: Record<string, unknown> = { ...extra };
    if (entry.spell?.shape && castBeast.value) body.beast = castBeast.value;
    if (entry.spell?.element?.length) body.element = entry.spell.element.includes(castElement.value) ? castElement.value : entry.spell.element[0];
    if (entry.spell?.modes?.length) body.mode = castMode.value || entry.spell.modes[0]!.id;
    if (castingEntry.value?.id === entry.id) {
      if (castTargets.value.length && !templateId) body.targetIds = castTargets.value;
      if (templateId || castArea.value) body.templateId = templateId || castArea.value;
      if (props.sceneId) body.sceneId = props.sceneId;
    }
    if (useRitual.value && entry.spell?.ritual && !props.inCombat) body.ritual = true;
    else if (useRacial.value && legacyOf(entry)) body.racial = true;
    else if (useFree.value && freeOf(entry)) body.free = freeOf(entry)!.kind;
    else if (usePact.value && pactCastable(entry)) body.pact = true;
    else {
      const level = entry.spell?.level ?? 0;
      const chosen = castSlot.value || slotChoices(entry)[0]?.level || 0;
      if (chosen > level) body.slotLevel = chosen;
    }
    if (castingEntry.value?.id === entry.id && entry.spell?.projectiles && castTargets.value.length > 1) {
      body.shots = castTargets.value.flatMap(id => Array.from({ length: shotsPer.value[id] ?? 0 }, () => id));
    }
    if (castingEntry.value?.id === entry.id && castMetamagic.value) body.metamagic = castMetamagic.value;
    if (castingEntry.value?.id === entry.id && castEmpowered.value) body.empowered = true;
    if (castingEntry.value?.id === entry.id && castOverchannel.value && overchannelReady(entry)) body.overchannel = true;
    if (castingEntry.value?.id === entry.id && castMetamagic.value === 'heightened' && castHeightened.value) body.heightenedTargetId = castHeightened.value;
    const spend = useInspiration.value && actor.inspired && Boolean(entry.spell?.mechanics?.attack);
    if (spend) body.inspiration = true;
    let outcome: any = null;
    return perform(async () => {
      const targeted = Boolean((body.targetIds as string[] | undefined)?.length || (body.shots as string[] | undefined)?.length);
      const result = await sendFriendly(warn => props.request(
        `/campaigns/${props.campaignId}/characters/${actor.characterId}/spells/${entry.id}/cast`, 'POST', warn && targeted ? { ...body, warnFriendly: true } : body,
      ));
      if (spend) useInspiration.value = false;
      outcome = result;
      if (result.pending) {
        castingEntry.value = null;
        emit('acted', `${spellName(entry)}: ждём — противник может ответить «Контрзаклинанием» (до ${Math.round(result.pending.expiresInMs / 1000)} с).`);
        return;
      }
      if (result.hurl) hurlOffer.value = { characterId: actor.characterId, ...result.hurl };
      if (result.slot?.pact && pactSlots.value) pactSlots.value = { ...pactSlots.value, current: result.slot.current };
      else if (result.slot) slotList.value = slotList.value.map(slot => (slot.level === result.slot.level ? result.slot : slot));
      castingEntry.value = null;
      const lines = (result.targets ?? []).map((target: any) => {
        const what = target.attack ? (target.attack.critical ? 'крит' : target.attack.hit ? 'попадание' : 'промах')
          : target.save ? (target.save.autoFail ? 'автопровал' : target.save.success ? 'устоял' : 'провал') : '';
        const amount = target.damage ? `, урон ${target.damage}` : target.healed ? `, +${target.healed} хит.` : '';
        const cover = target.cover === 'half' ? ' (укрытие +2)' : target.cover === 'three-quarters' ? ' (укрытие +5)' : '';
        const shots = target.shots > 1 ? ` ×${target.shots}` : '';
        const effects = Array.isArray(target.effects) ? target.effects.filter((entry: string) => entry.startsWith('отброшен') || /облик|согласен|0 хитов|опасность/.test(entry)) : [];
        if (target.summoned) return `${target.name}: призван`;
        if (Array.isArray(target.notes) && target.notes.length && !target.shaped) return `${target.name}: ${target.notes.join(', ')}`;
        if (target.shaped) return `${target.name}: облик — ${target.shaped}`;
        if (target.willing && !effects.length) return `${target.name}: согласен`;
        return `${target.name}: ${what}${shots}${cover}${amount}${target.condition ? ', состояние' : ''}${effects.length ? `, ${effects.join(', ')}` : ''}`;
      });
      if (lines.length) emit('acted', `${spellName(entry)}: ${lines.join('; ')}`.replace(/\.?$/, '.'));
    }).then(() => outcome);
  }

  return { cast };
}
