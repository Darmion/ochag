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
    return { message: `${use.row.name}: «За мной!»`, float: 'боевой клич', economyScene: spent?.sceneId ?? null, heal: null };
  });
  api.features.view('battle-cry', look => ({
    detail: 'бонусным действием',
    reason: look.unable ?? look.bonusReason,
  }));

  api.log('готов: «Второе дыхание» с ТЕЛ и «Боевой клич»');
}
