DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ttrpg_app') THEN
    CREATE ROLE ttrpg_app LOGIN;
  END IF;
  EXECUTE format('ALTER ROLE ttrpg_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',current_setting('ttrpg.app_password'));
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ttrpg_app',current_database());
END $$;
GRANT USAGE ON SCHEMA public TO ttrpg_app;
GRANT SELECT ON schema_migrations,users,accounts,auth_sessions,campaigns,campaign_members,permission_catalog,member_permissions,campaign_invites TO ttrpg_app;
GRANT INSERT ON users,accounts,auth_sessions,campaigns,campaign_members,member_permissions,campaign_invites TO ttrpg_app;
GRANT UPDATE ON campaigns,campaign_members,campaign_invites TO ttrpg_app;
GRANT DELETE ON auth_sessions,member_permissions TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE
  ON characters, import_drafts
  TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE
  ON scenes
  TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE
  ON assets
  TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON scene_objects
  TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON scene_walls, scene_fog_state
  TO ttrpg_app;
GRANT SELECT
  ON character_vision_overrides
  TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON character_effects
  TO ttrpg_app;
GRANT SELECT, INSERT
  ON roll_log
  TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON initiative_entries, character_resources
  TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON campaign_notes, campaign_note_grants
  TO ttrpg_app;