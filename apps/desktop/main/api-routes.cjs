

// Route allowlist for the renderer, checked in the main process before any request; new server routes must be added here.
const SEGMENT = '[A-Za-z0-9_-]+';
// Field keys also allow ':' (skill:acrobatics, effect:<uuid>).
const FIELD_KEY_SEGMENT = '[A-Za-z0-9_:-]+';
const allowedRoute = new RegExp(
  '^/(?:' +
    'health|me|mods|importers|' +
    'auth/(?:login|register|logout)|' +
    'srd/(?:skills|weapons|gear|monsters|heroes|magic-items)|' +
    `srd/spells(?:/${SEGMENT}/(?:translation|flag|mechanics))?|` +
    `campaigns(?:/${SEGMENT})*/visibility/${FIELD_KEY_SEGMENT}|` +
    `campaigns(?:/${SEGMENT})*(?:\\?(?:kind=(?:scene_background|object_model|object_image|audio|art_sprite|campaign_avatar|campaign_banner)|viewAs=${SEGMENT}|looterId=${SEGMENT}|sceneId=${SEGMENT}|targetId=${SEGMENT}|fogAs=party|fogOf=${SEGMENT}|mode=drag|classId=[a-z]{3,12}))?|` +
    `campaigns/${SEGMENT}/rolls/attack-preview\\?characterId=${SEGMENT}&key=${SEGMENT}(?:&targetCharacterId=${SEGMENT})?(?:&sceneId=${SEGMENT})?&advantage=(?:none|adv|disadv)(?:&twoHanded=true)?(?:&power=true)?` +
  ')$',
);

module.exports = { allowedRoute };
