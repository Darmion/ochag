const TEXT_LABELS: Record<string, string> = {
  traits: 'Черты',
  personality: 'Личность',
  ideals: 'Идеалы',
  bonds: 'Привязанности',
  flaws: 'Слабости',
  background: 'Предыстория',
  backstory: 'Предыстория',
  features: 'Умения и особенности',
  prof: 'Владения и языки',
  equipment: 'Снаряжение',
  items: 'Предметы',
  attacks: 'Атаки (заметки)',
  allies: 'Союзники и организации',
  quests: 'Задания',
  notes: 'Заметки',
};

const BLOCK_NODES = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'hardBreak']);

export function plainText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join('\n');
  if (typeof value !== 'object') return '';
  const node = value as Record<string, unknown>;
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) {
    const parts = node.content.map(child => {
      const text = plainText(child);
      const type = child && typeof child === 'object' ? (child as Record<string, unknown>).type : undefined;
      return typeof type === 'string' && BLOCK_NODES.has(type) ? `${text}\n` : text;
    });
    return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  }
  for (const key of ['value', 'data', 'description']) {
    if (key in node) return plainText(node[key]);
  }
  return '';
}

function textLabel(key: string, value: unknown) {
  const name = value && typeof value === 'object' ? (value as Record<string, unknown>).name : undefined;
  if (typeof name === 'string' && name.trim()) return name.trim();
  const base = key.replace(/[-_]\d+$/, '');
  return TEXT_LABELS[key] ?? TEXT_LABELS[base] ?? key.replace(/[-_]/g, ' ');
}

export function sheetTexts(text: unknown): Array<{ key: string; label: string; body: string }> {
  if (!text || typeof text !== 'object') return [];
  return Object.entries(text as Record<string, unknown>)
    .map(([key, value]) => ({ key, label: textLabel(key, value), body: plainText(value) }))
    .filter(entry => entry.body);
}

export function sheetResources(resources: unknown): Array<{ key: string; label: string; value: string }> {
  if (!resources || typeof resources !== 'object') return [];
  return Object.entries(resources as Record<string, unknown>).map(([key, raw]) => {
    if (!raw || typeof raw !== 'object') return { key, label: key, value: plainText(raw) };
    const item = raw as Record<string, unknown>;
    const label = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : key;
    const current = item.current ?? item.value;
    const value = item.max !== undefined ? `${plainText(current) || 0} / ${plainText(item.max)}` : plainText(current);
    return { key, label, value };
  }).filter(entry => entry.value);
}

export function describe(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object') return String(value);
  const text = plainText(value);
  if (text) return text;
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null && item !== undefined && item !== '')
    .map(([key, item]) => `${key}: ${typeof item === 'object' ? plainText(item) || JSON.stringify(item) : item}`)
    .join(', ') || '—';
}

export function weaponTitle(weapon: unknown) {
  if (weapon && typeof weapon === 'object' && 'name' in weapon) return plainText((weapon as Record<string, unknown>).name) || 'Оружие';
  return describe(weapon);
}
