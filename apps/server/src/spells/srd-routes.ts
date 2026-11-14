import { srdSpells, srdSkills, srdSpellRuFields } from '../rules/srd-data.ts';
import { SRD_WEAPONS, srdWeaponFields } from '../../../../packages/domain/srd/weapons.ts';

import { srdEffective, textMechanics } from './mechanics.ts';
import type { RouteContext } from '../system/route-context.ts';

export function registerSrdRoutes(ctx: RouteContext) {
  const { app, auth } = ctx;

  app.get('/srd/skills', async request => {
    await auth(request);
    return { skills: srdSkills };
  });

  app.get('/srd/weapons', async request => {
    await auth(request);
    return { weapons: SRD_WEAPONS.map(weapon => ({ ...weapon, fields: srdWeaponFields(weapon) })) };
  });

  app.get('/srd/spells', async request => {
    await auth(request);

    const spells = srdSpells.map(spell => ({
      ...spell,
      ...srdSpellRuFields(spell.index),
      damageFormula: null,
      healingFormula: null,
      upcastFormula: null,
      mechanics: srdEffective(spell, null),
      mechanicsOverrides: null,
      ...textMechanics(spell),
    }));

    return { spells };
  });
}
