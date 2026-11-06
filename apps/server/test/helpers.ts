import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {Database} from '../src/db.ts';

const MIGRATIONS = [
  '001_foundation.sql',
  '002_accounts.sql',
  '003_import_preview.sql',
  '004_feet.sql',
  '005_shared_tabletop.sql',
  '006_scene_media.sql',
  '007_scene_objects.sql',
  '008_vision_geometry.sql',
  '009_combat.sql',
  '010_effects_resources.sql',
  '011_campaign_notes.sql',
  '012_object_animations.sql',
  '013_spells_skills.sql',
  '014_character_visibility.sql',
  '015_character_access_and_spell_review.sql',
  '016_character_saves.sql',
  '017_open_logins_and_server_identity.sql',
  '018_campaign_creators.sql',
  '019_shared_control.sql',
  '020_character_removal.sql',
  '021_campaign_rules.sql',
  '022_character_level.sql',
  '023_spell_slots.sql',
  '024_upcast_and_weapons.sql',
  '025_unified_objects.sql',
  '026_scene_drawings.sql',
  '027_scene_pins.sql',
  '028_campaign_audio.sql',
  '029_composite_rolls.sql',
  '030_encounters.sql',
  '031_scene_counters.sql',
  '032_playlists.sql',
  '033_inventory.sql',
  '034_object_states.sql',
  '035_blocking_objects.sql',
  '036_lighting.sql',
  '037_damage_threshold.sql',
  '038_movement.sql',
  '039_area_templates.sql',
  '040_triggers.sql',
  '041_conditions.sql',
  '042_weapon_damage.sql',
  '043_spell_targets.sql',
  '044_rest.sql',
  '045_experience.sql',
  '046_inspiration.sql',
  '047_quests.sql',
  '048_action_economy.sql',
  '049_classes.sql',
  '050_weapon_ranges.sql',
  '051_combat_summary.sql',
  '052_world_time.sql',
  '053_stealth_secrets.sql',
  '054_handouts.sql',
  '055_dialogues.sql',
  '056_chat.sql',
  '057_money.sql',
  '058_hazards.sql',
  '059_mood_music.sql',
  '060_chronicle.sql',
  '061_bestiary.sql',
  '062_roll_tables.sql',
  '063_class_features_bosses.sql',
  '064_magic_items.sql',
  '065_spell_zones.sql',
  '066_roll_applications.sql',
  '067_long_rest_daily.sql',
  '068_multiclass.sql',
  '069_combat_leftovers.sql',
  '070_map_tweaks.sql',
  '071_walls_and_steps.sql',
  '072_auto_reactions.sql',
  '073_scene_rest.sql',
  '074_light_cone.sql',
  '075_auto_counterspell.sql',
  '076_combat_events.sql',
  '077_more_reactions.sql',
  '078_deflect_missiles.sql',
  '079_uncanny_dodge.sql',
  '080_colossus_slayer.sql',
  '081_more_maneuvers.sql',
  '082_legendary_resistance.sql',
  '083_doors_windows.sql',
  '084_reaction_attacks.sql',
  '085_open_registration.sql',
  '086_campaign_art.sql',
  '087_drop_spell_translations.sql',
  '088_scene_music.sql',
  '089_scene_grid.sql',
  '090_campaign_appearance.sql',
  '091_scene_ambience.sql',
  '092_blocker_kind.sql',
  '093_image_crops.sql',
  '094_factions.sql',
  '095_round20.sql',
  '096_round21.sql',
  '097_zone_height.sql',
  '098_spell_templates.sql',
  '099_srd_spell_templates.sql',
];

export async function createTestDatabase(): Promise<{pg: PGlite; db: Database}> {
  const pg = new PGlite();

  // The role must exist (bare, no password) before migrations 3+ GRANT to it — as in scripts/migrate.ts.
  await pg.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ttrpg_app') THEN
      CREATE ROLE ttrpg_app LOGIN;
    END IF;
  END $$;`);

  for (const file of MIGRATIONS) {
    await pg.exec(await readFile(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  }

  // provision_runtime.sql grants on tables from every migration, so it runs after all of them.
  await pg.query("SELECT set_config('ttrpg.app_password', $1, false)", ['test-runtime-password-123456789']);
  await pg.exec(await readFile(new URL('../../../db/provision_runtime.sql', import.meta.url), 'utf8'));

  const db: Database = {
    query: async (sql, values) => pg.query(sql, values),
    transaction: fn => pg.transaction(q => fn({query: async (sql, values) => q.query(sql, values)})),
  };

  return {pg, db};
}
