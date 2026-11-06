import { srdSpells, srdSkills, findSrdSpell, srdSpellRuFields } from '../rules/srd-data.ts';
import { SRD_WEAPONS, srdWeaponFields } from '../../../../packages/domain/srd/weapons.ts';

import { reject } from '../characters/sheet/shared.ts';
import { MECHANICS_COLUMNS, mechanicsAssignments, mechanicsBody, overridesView, srdEffective, textMechanics, validateSpellFormula, validateUpcastFormula } from './mechanics.ts';
import type { RouteContext } from '../system/route-context.ts';

type SrdSpellParams = { index: string };

export const srdSpellParams = {
  type: 'object', required: ['index'], additionalProperties: false,
  properties: { index: { type: 'string', minLength: 1, maxLength: 100 } },
};

export function registerSrdRoutes(ctx: RouteContext) {
  const { app, auth, db } = ctx;

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

    const mechanics = (
      await db.query(
        `SELECT srd_index, damage_formula, healing_formula, upcast_formula, ${MECHANICS_COLUMNS.join(', ')} FROM srd_spell_mechanics`,
      )
    ).rows;
    const mechanicsByIndex = new Map(mechanics.map(m => [m.srd_index, m]));

    const spells = srdSpells.map(spell => {
      const m = mechanicsByIndex.get(spell.index);
      return {
        ...spell,
        ...srdSpellRuFields(spell.index),
        damageFormula: m?.damage_formula ?? null,
        healingFormula: m?.healing_formula ?? null,
        upcastFormula: m?.upcast_formula ?? null,
        mechanics: srdEffective(spell, m),
        mechanicsOverrides: overridesView(m),
        ...textMechanics(spell),
      };
    });

    return { spells };
  });

  app.post<{ Params: SrdSpellParams; Body: Record<string, any> & { damageFormula?: string | null; healingFormula?: string | null; upcastFormula?: string | null } }>(
    '/srd/spells/:index/mechanics',
    {
      schema: {
        params: srdSpellParams,
        body: {
          type: 'object', minProperties: 1, additionalProperties: false,
          properties: {
            damageFormula: { type: ['string', 'null'], maxLength: 200 },
            healingFormula: { type: ['string', 'null'], maxLength: 200 },
            upcastFormula: { type: ['string', 'null'], maxLength: 20 },
            ...mechanicsBody,
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { index } = request.params;
      if (!findSrdSpell(index)) reject(404, 'Заклинание SRD не найдено.');
      const { damageFormula, healingFormula, upcastFormula } = request.body;
      validateSpellFormula(damageFormula ?? null, 'Формула урона');
      validateSpellFormula(healingFormula ?? null, 'Формула лечения');
      validateUpcastFormula(upcastFormula ?? null);

      const { rows } = await db.query(
        `INSERT INTO srd_spell_mechanics (srd_index, damage_formula, healing_formula, upcast_formula, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (srd_index) DO UPDATE SET
           damage_formula = COALESCE($2, srd_spell_mechanics.damage_formula),
           healing_formula = COALESCE($3, srd_spell_mechanics.healing_formula),
           upcast_formula = COALESCE($4, srd_spell_mechanics.upcast_formula),
           updated_by=$5, updated_at=now()
         RETURNING srd_index, damage_formula AS "damageFormula", healing_formula AS "healingFormula",
                   upcast_formula AS "upcastFormula"`,
        [index, damageFormula ?? null, healingFormula ?? null, upcastFormula ?? null, userId],
      );

      const { sets, values } = mechanicsAssignments(request.body, 2);
      let row = null;
      if (sets.length) {
        row = (await db.query(`UPDATE srd_spell_mechanics SET ${sets.join(', ')} WHERE srd_index=$1 RETURNING *`, [index, ...values])).rows[0];
      } else {
        row = (await db.query('SELECT * FROM srd_spell_mechanics WHERE srd_index=$1', [index])).rows[0];
      }

      return { ...rows[0], mechanics: srdEffective(findSrdSpell(index), row), mechanicsOverrides: overridesView(row) };
    },
  );
}
