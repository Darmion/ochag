import { type FieldKey, type MappingRow, type Proposal, fieldDefinitions } from '../../../packages/importer/proposal/fields.ts';
import { ABILITY_BY_SHORT, SKILLS, integer, numberOrNull, object, readPath, signedNumber, text, valueOf } from '../../../packages/importer/proposal/internal.ts';
import { type ImportedStructure, normalizeStructure, structureSummary } from '../../../packages/importer/proposal/structure.ts';
import { spellLinks } from './spells.ts';
import { lssWeapon } from './weapons.ts';

function readStructure(data: Record<string, any>, references: Record<string, any> = {}): ImportedStructure {
  const info = object(data.info);
  const vitality = object(data.vitality);
  const stats = object(data.stats);
  const proficiencyBonus = integer(data.proficiency, 0, 10) ?? 2;
  const modifier = (ability: string) => {
    const short = Object.entries(ABILITY_BY_SHORT).find(([, name]) => name === ability)?.[0] ?? 'str';
    const score = numberOrNull(object(stats[short]).score);
    return score === null ? 0 : Math.floor((score - 10) / 2);
  };

  const className = text(info.charClass) ?? text(info.class);
  const subclass = text(info.charSubclass) ?? text(info.subclass);

  const skills = Object.entries(object(data.skills)).flatMap(([key, entry]) => {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    const index = SKILLS.find(skill => skill.replace(/-/g, '') === normalized);
    if (!index) return [];
    const raw = typeof entry === 'object' && entry !== null ? (entry as any).isProf : entry;
    const level = raw === true ? 1 : numberOrNull(raw) ?? 0;
    return level > 0 ? [{ index, proficient: true, expertise: level >= 2 }] : [];
  });

  const saves = Object.entries(object(data.saves)).flatMap(([key, entry]) => {
    const proficient = entry === true || (typeof entry === 'object' && entry !== null && Boolean((entry as any).isProf));
    const ability = ABILITY_BY_SHORT[key.toLowerCase().slice(0, 3)];
    return proficient && ability ? [ability] : [];
  });

  const weapons = (Array.isArray(data.weaponsList) ? data.weaponsList : []).flatMap((raw: unknown) => {
    const weapon = lssWeapon(raw, modifier, proficiencyBonus);
    return weapon ? [weapon] : [];
  });


  const spellSlots = Object.entries(object(data.spells)).flatMap(([key, entry]) => {
    const match = /^slots-(\d)$/.exec(key);
    if (!match) return [];
    const max = numberOrNull(valueOf(entry));
    const filled = numberOrNull(object(entry).filled) ?? 0;
    return max && max > 0 ? [{ level: Number(match[1]), max, current: Math.max(0, max - filled) }] : [];
  });

  const resources = Object.values(object(data.resources)).flatMap(raw => {
    const entry = object(raw);
    const name = text(entry.name) ?? text(entry.label);
    const max = numberOrNull(valueOf(entry.max));
    return name && max !== null ? [{ name, max, current: numberOrNull(valueOf(entry.current)) ?? max }] : [];
  });

  const hitDie = numberOrNull(text(vitality['hit-die'] ?? vitality.hitDie)?.replace(/^\d*[dк]/i, '') ?? null);

  const pactSlots = Object.entries(object(data.spellsPact)).flatMap(([key, entry]) => {
    const match = /^slots-(\d)$/.exec(key);
    const max = numberOrNull(valueOf(entry));
    if (!match || !max || max <= 0) return [];
    return [{ level: Number(match[1]), max, current: Math.max(0, max - (numberOrNull(object(entry).filled) ?? 0)) }];
  }).sort((a, b) => b.level - a.level)[0] ?? null;

  const textBlocks = object(data.text);
  const spells = Object.entries(textBlocks).flatMap(([key, entry]) => {
    const match = /^spells-level-(\d)$/.exec(key);
    if (!match) return [];
    return spellLinks(object(valueOf(entry)).data, Number(match[1]));
  });

  return normalizeStructure({
    className: className && subclass && !/\d/.test(className) ? `${className} (${subclass})` : className,
    level: valueOf(info.level),
    experience: valueOf(info.experience),
    hitDie,
    spellcastingAbility: object(data.spellsInfo).base?.code ?? valueOf(object(data.spellsInfo).base) ?? data.spellsInfo?.ability,
    skills, saves, weapons, spellSlots, resources, pactSlots, spells,
    spellSaveDc: signedNumber(object(data.spellsInfo).save, 1, 40),
    spellAttack: signedNumber(object(data.spellsInfo).mod, -10, 30),
    lssSpells: { prepared: references.prepared, book: references.book, granted: references.granted, slotless: references.slotless },
  });
}

export function parseLss(original: Record<string, unknown>) {
  let data: Record<string, any>;

  if (typeof original.data === 'string') {
    try {
      data = object(JSON.parse(original.data));
    } catch {
      throw new Error('Поле data содержит некорректный JSON.');
    }
  } else {
    data = object(original.data ?? original);
  }

  if (
    data.jsonType !== 'character' ||
    Object.keys(object(data.stats)).length === 0
  ) {
    throw new Error('Файл не похож на лист персонажа Long Story Short.');
  }

  const paths: Record<FieldKey, string> = {
    name: 'name.value',
    strength: 'stats.str.score',
    dexterity: 'stats.dex.score',
    constitution: 'stats.con.score',
    intelligence: 'stats.int.score',
    wisdom: 'stats.wis.score',
    charisma: 'stats.cha.score',
    hp_current: 'vitality.hp-current.value',
    hp_max: 'vitality.hp-max.value',
    hp_temp: 'vitality.hp-temp.value',
    armor_class: 'vitality.ac.value',
    speed_feet: 'vitality.speed.value',
  };

  const values = {} as Record<FieldKey, string | number | null>;
  const mapping: MappingRow[] = [];
  const warnings: string[] = [];

  for (const definition of fieldDefinitions) {
    const sourceValue = readPath(data, paths[definition.key]);

    mapping.push({
      key: definition.key,
      label: definition.label,
      sourcePath: paths[definition.key],
      sourceValue,
    });

    values[definition.key] = definition.type === 'text'
      ? typeof sourceValue === 'string' ? sourceValue : ''
      : numberOrNull(sourceValue);
  }

  if (values.hp_temp === null) {
    values.hp_temp = 0;
    warnings.push(
      'Временные хиты не указаны: предложено значение 0.',
    );
  }

  if (values.speed_feet === null) {
    values.speed_feet = 30;
    warnings.push('Скорость в листе не указана: предложено 30 футов — проверьте, у расы может быть иначе.');
  }

  const sourceEdition = original.edition ?? null;
  const sheetEdition = original.sheetEdition ?? null;

  if (
    sourceEdition === '2024' ||
    sheetEdition === '2024' ||
    sourceEdition !== sheetEdition
  ) {
    warnings.push(
      'Проверьте редакцию: файл содержит разные или отличные от 2014 ' +
      'метки правил. Импорт не выполняет автоматическую конвертацию редакций.',
    );
  }

  const spellReferences = object(original.spells);

  const importedStructure = readStructure(data, spellReferences);
  if (Object.values(importedStructure.lssSpells).some(list => list.length)) {
    warnings.push(
      'Заклинания LSS записаны внутренними номерами их базы — названий в файле нет. ' +
      'После импорта во вкладке «Заклинания» их можно сопоставить один раз: ' +
      'остальные персонажи кампании с теми же заклинаниями получат их сами.',
    );
  }
  const mentioned = [...new Set(Object.entries(object(data.text))
    .filter(([key]) => !/^spells-level-\d$/.test(key))
    .flatMap(([, entry]) => {
      return spellLinks(object(valueOf(entry)).data, null).map(spell => spell.nameRu ?? spell.slug);
    }))];
  if (mentioned.length) warnings.push(`В тексте листа упомянуты заклинания: ${mentioned.slice(0, 10).join(', ')} — добавьте их вручную, если они у персонажа есть.`);
  const summary = structureSummary(importedStructure);
  if (summary) warnings.push(`Перенесётся в лист: ${summary}.`);
  warnings.push(
    'Текстовые особенности, предметы и описания остаются данными листа ' +
    '(видны во вкладке «Эффекты и ресурсы»), сами в игровые эффекты не превращаются.',
    'Проверьте тёмное зрение: числовое поле и описание могут расходиться.',
  );

  const proposal = {
    ...values,
    sheet_extra: {
      info: object(data.info),
      subInfo: object(data.subInfo),
      proficiency: data.proficiency ?? null,
      saves: object(data.saves),
      skills: object(data.skills),
      spellsInfo: object(data.spellsInfo),
      spellSlots: object(data.spells),
      spellReferences,
      weapons: Array.isArray(data.weaponsList)
        ? data.weaponsList
        : [],
      text: object(data.text),
      coins: object(data.coins),
      resources: object(data.resources),
      conditions: Array.isArray(data.conditions)
        ? data.conditions
        : [],
      darkvisionFeet:
        numberOrNull(data.vitality?.darkvision?.value),
      sourceMetadata: {
        format: 'long-story-short',
        edition: sourceEdition,
        sheetEdition,
      },
      importedStructure,
    },
  } as Proposal;

  return { proposal, mapping, warnings };
}
