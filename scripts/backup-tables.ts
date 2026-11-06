// FK-safe insert order. Every data table must be listed: restore truncates with CASCADE (backup-tables.test.ts compares this list with the schema).
export const BACKUP_TABLES = [
  'users', 'campaigns', 'campaign_members', 'member_permissions',
  'accounts', 'auth_sessions', 'campaign_invites',
  'assets',
  'characters', 'import_drafts',
  'factions', 'faction_members', 'faction_relations',
  'scenes', 'scene_objects', 'scene_walls', 'scene_fog_state', 'scene_drawings', 'scene_counters', 'scene_templates', 'scene_triggers',
  'character_effects', 'character_vision_overrides', 'character_resources',
  'character_skills', 'character_saves',
  'campaign_spells', 'campaign_spell_refs', 'campaign_spell_revisions', 'campaign_srd_templates', 'character_spells', 'character_spell_slots', 'character_weapons',
  'character_field_visibility', 'character_field_visibility_grants', 'character_access_grants', 'object_states', 'magic_items',
  'roll_log', 'roll_applications', 'initiative_entries', 'scene_opportunities', 'combat_events',
  'campaign_notes', 'campaign_note_grants', 'scene_pins',
  'campaign_rules', 'campaign_audio', 'campaign_encounters', 'campaign_quests', 'campaign_quest_objectives',
  'handouts', 'handout_recipients', 'dialogues', 'chat_messages', 'combat_records', 'chronicle_entries', 'dialogue_sessions', 'roll_tables',
  'srd_spell_mechanics',
  'campaign_art',
] as const;

export const LATE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  campaigns: ['avatar_asset_id', 'banner_asset_id'],
};

export const NOT_BACKED_UP = ['schema_migrations', 'permission_catalog', 'server_instance'] as const;
