import type { Queryable } from '../db.ts';

export type ModRuleOption = { value: string; label: string };
export type ModCampaignRule = {
  key: string; label: string; description: string; kind: 'flag' | 'choice';
  default: boolean | string; options: ModRuleOption[]; modName: string; topic: string | null;
};

const TOPICS = ['combat', 'movement', 'magic', 'recovery', 'characters', 'exploration', 'other'];

export const MOD_RULE_KEY = /^mod_[a-z0-9_]{1,59}$/;
const MOD_RULES = new Map<string, ModCampaignRule>();

const line = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');

export function normalizeModCampaignRule(input: unknown, modName: string): ModCampaignRule | string {
  if (!input || typeof input !== 'object') return 'нужен объект правила';
  const raw = input as Record<string, unknown>;
  const key = typeof raw.key === 'string' ? raw.key : '';
  if (!MOD_RULE_KEY.test(key)) return `ключ «${key}»: mod_ и строчные латинские буквы, цифры, «_»`;
  const label = line(raw.label, 120);
  if (!label) return `«${key}»: нужна подпись`;
  const description = line(raw.description, 600);
  const topic = typeof raw.topic === 'string' && TOPICS.includes(raw.topic) ? raw.topic : null;
  if (raw.kind === 'choice') {
    const options = (Array.isArray(raw.options) ? raw.options : []).slice(0, 12)
      .map(option => ({ value: line((option as any)?.value, 40), label: line((option as any)?.label, 300) }))
      .filter(option => /^[a-z0-9_-]{1,40}$/.test(option.value) && option.label);
    if (options.length < 2) return `«${key}»: у выбора нужно хотя бы два варианта с value и label`;
    const fallback = typeof raw.default === 'string' && options.some(option => option.value === raw.default) ? raw.default : options[0]!.value;
    return { key, label, description, kind: 'choice', default: fallback, options, modName, topic };
  }
  return { key, label, description, kind: 'flag', default: raw.default === true, options: [], modName, topic };
}

export function defineModCampaignRule(rule: ModCampaignRule) {
  MOD_RULES.set(rule.key, rule);
}

export function modCampaignRules(): ModCampaignRule[] {
  return [...MOD_RULES.values()];
}

export function modCampaignRule(key: string): ModCampaignRule | undefined {
  return MOD_RULES.get(key);
}

export async function modRuleValue(q: Queryable, campaignId: string, key: string): Promise<boolean | string | null> {
  const rule = MOD_RULES.get(key);
  if (!rule) return null;
  const row = (await q.query('SELECT kind, value FROM campaign_rules WHERE campaign_id=$1 AND key=$2', [campaignId, key])).rows[0] as { kind: string; value: unknown } | undefined;
  if (rule.kind === 'flag') return row?.kind === 'flag' && typeof row.value === 'boolean' ? row.value : rule.default;
  return row?.kind === 'text' && rule.options.some(option => option.value === row.value) ? row.value as string : rule.default;
}

export function modRuleProblem(key: string, kind: string, value: unknown): string | null {
  const rule = MOD_RULES.get(key);
  if (!rule) return null;
  if (rule.kind === 'flag') return kind === 'flag' ? null : `«${rule.label}» — переключатель правила мода «${rule.modName}».`;
  if (kind !== 'text' || !rule.options.some(option => option.value === value)) {
    return `«${rule.label}» — выбор из списка мода «${rule.modName}»: ${rule.options.map(option => option.value).join(', ')}.`;
  }
  return null;
}
