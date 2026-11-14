// Example mechanics mod (docs/MODS.md). The GM's server loads it from the mods
// folder at startup and passes `api`; nothing else needs to be imported.

export default function (api) {
  // 1. Wrap a built-in feature: Second Wind also heals the Constitution modifier.
  const builtIn = api.features.actionOf('second-wind');
  api.features.action('second-wind', async use => {
    const done = await builtIn(use);
    const extra = Math.max(0, Math.floor((Number(use.row.constitution ?? 10) - 10) / 2));
    if (!extra) return done;
    await use.ctx.applyHpChange(use.q, use.campaignId, use.userId, use.characterId, { mode: 'heal', amount: extra, damageType: null, critical: false });
    return { ...done, message: `${done.message} И ещё +${extra} от Телосложения.` };
  });

  // 2. A new class feature: who gets it and from which level, what it does, how its button looks.
  api.features.define({
    id: 'battle-cry', classId: 'fighter', level: 3, name: 'Боевой клич', resource: null, use: 'bonus',
    text: 'Бонусным действием воин издаёт боевой клич: союзники видят, что он рядом.',
  });
  api.features.action('battle-cry', async use => {
    const spent = await use.ctx.actionEconomy.spend(use.q, use.campaignId, use.characterId, 'bonus', { kind: 'other' }, { enforce: use.enforce, sceneId: use.sceneId });
    // The campaign's switch from step 4 decides what the cry says.
    const rallies = await api.rules.value(use.q, use.campaignId, 'mod_battle_cry_rallies');
    const message = rallies ? `${use.row.name}: «За мной!» — союзники рядом воодушевлены.` : `${use.row.name}: «За мной!»`;
    return { message, float: 'боевой клич', economyScene: spent?.sceneId ?? null, heal: null };
  });
  api.features.view('battle-cry', look => ({
    detail: 'бонусным действием',
    reason: look.unable ?? look.bonusReason,
  }));

  // 3. A condition: what it does is a list of clauses, the same ones the GM edits on the Conditions tab.
  // A new one takes a code mod_…; an SRD code (for example 'poisoned') replaces that rule.
  api.conditions.define({
    code: 'mod_rallied', name: 'Воодушевлён', kind: 'effect', icon: 'blessed',
    description: 'Услышал боевой клич: смелее нападает минуту.',
    clauses: [
      { kind: 'roll-bonus', values: { rolls: 'attacks', value: '1' } },
      { kind: 'lasts', values: { minutes: '1' } },
    ],
  });

  // 4. A campaign rule: a switch in the Rules window, next to the app's own; the GM turns it on or off.
  // `kind: 'choice'` with `options: [{ value, label }, …]` makes a list instead.
  api.rules.define({
    key: 'mod_battle_cry_rallies', kind: 'flag', topic: 'combat', label: 'Боевой клич воодушевляет',
    description: 'Боевой клич воина воодушевляет союзников рядом (мод «Второе дыхание с Телосложением»).', default: true,
  });

  api.log('готов: «Второе дыхание» с ТЕЛ, «Боевой клич», «Воодушевлён» и правило клича');
}
