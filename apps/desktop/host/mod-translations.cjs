'use strict';

const LANGUAGE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
const LIMITS = { name: 200, description: 500, author: 200 };

function readTranslations(raw, sectionIds = []) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [code, value] of Object.entries(raw).slice(0, 20)) {
    if (!LANGUAGE.test(code) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = {};
    for (const [field, limit] of Object.entries(LIMITS)) {
      if (typeof value[field] === 'string' && value[field].trim()) entry[field] = value[field].trim().slice(0, limit);
    }
    if (value.sections && typeof value.sections === 'object' && !Array.isArray(value.sections)) {
      const sections = {};
      for (const id of sectionIds) {
        if (typeof value.sections[id] === 'string' && value.sections[id].trim()) sections[id] = value.sections[id].trim().slice(0, 200);
      }
      if (Object.keys(sections).length) entry.sections = sections;
    }
    if (Object.keys(entry).length) out[code.toLowerCase()] = entry;
  }
  return out;
}

module.exports = { readTranslations };
