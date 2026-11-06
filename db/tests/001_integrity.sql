-- Non-destructive: everything is rolled back. Any unexpected outcome aborts psql.
BEGIN;
DO $$
DECLARE
 u uuid := gen_random_uuid(); c uuid := gen_random_uuid();
 other_c uuid := gen_random_uuid(); ch uuid := gen_random_uuid();
BEGIN
 INSERT INTO users(id,display_name) VALUES (u,'Integrity test');
 INSERT INTO campaigns(id,name,owner_user_id) VALUES (c,'Test',u),(other_c,'Other',u);
 INSERT INTO campaign_members(campaign_id,user_id) VALUES (c,u),(other_c,u);
 SET CONSTRAINTS ALL IMMEDIATE;
 INSERT INTO characters(id,campaign_id,owner_user_id,name) VALUES (ch,c,u,'Test character');
 BEGIN
  INSERT INTO characters(campaign_id,name,hp_current) VALUES (c,'Invalid',-1);
  RAISE EXCEPTION 'Negative HP was accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO character_effects(campaign_id,character_id,effect_code) VALUES (other_c,ch,'blinded');
  RAISE EXCEPTION 'Cross-campaign effect was accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  DELETE FROM campaign_members WHERE campaign_id=c AND user_id=u;
  RAISE EXCEPTION 'Owner membership deletion was accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO member_permissions VALUES (c,u,'unknown.permission');
  RAISE EXCEPTION 'Unknown permission was accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 INSERT INTO import_drafts(campaign_id,created_by,original_document,proposed_document)
 VALUES (c,u,'{}','{"name":"Edited preview"}');
 IF (SELECT name FROM characters WHERE id=ch) <> 'Test character' THEN
  RAISE EXCEPTION 'Preview changed a character';
 END IF;
 RAISE NOTICE 'Integrity checks passed';
END $$;
ROLLBACK;
