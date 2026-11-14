import type { Queryable } from '../db.ts';
import {
  CONDITION_KINDS, CUSTOM_CODE, builtInRule, builtInRules, normalizeClauses, normalizeStages, type Clause, type ConditionKind, type ConditionRule, type ConditionStage, type RuleSet,
} from '../../../../packages/domain/combat/condition-rules.ts';
import { CONDITION_LABELS } from '../../../../packages/domain/combat/conditions.ts';

// One server process owns the table: a campaign's rules are read once and dropped whenever the GM saves a change.
const cache = new Map<string, RuleSet>();

export function invalidateConditionRules(campaignId: string) {
  cache.delete(campaignId);
}

// A stored SRD condition without clauses keeps the SRD rules and changes only its look (icon or picture); the same for its stages.
export function ruleFromRow(row: Record<string, any>): ConditionRule {
  const base = builtInRule(String(row.code));
  const clauses = row.clauses == null && base ? base.clauses : normalizeClauses(row.clauses);
  const stages: ConditionStage[] = row.stages == null ? base?.stages ?? [] : normalizeStages(row.stages);
  return {
    code: String(row.code),
    name: base?.name ?? String(row.name),
    icon: String(row.icon ?? base?.icon ?? 'alert'),
    kind: base?.kind ?? ((CONDITION_KINDS as readonly string[]).includes(row.kind) ? row.kind as ConditionKind : 'condition'),
    clauses,
    ...(stages.length ? { stages } : {}),
    description: String(row.description || base?.description || ''),
    ...(row.icon_asset_id ? { iconAssetId: String(row.icon_asset_id) } : {}),
    ...(base?.asTarget ? { asTarget: base.asTarget } : {}),
  };
}

const canon = (clauses: readonly Clause[]) => JSON.stringify(clauses.map(entry => [entry.kind, Object.keys(entry.values).sort().map(key => [key, entry.values[key]])]));

export function sameClauses(a: readonly Clause[], b: readonly Clause[]) {
  return canon(a) === canon(b);
}

export function sameStages(a: readonly ConditionStage[] | undefined, b: readonly ConditionStage[] | undefined) {
  const flat = (list: readonly ConditionStage[] | undefined) => JSON.stringify((list ?? []).map(stage => [stage.name, canon(stage.clauses)]));
  return flat(a) === flat(b);
}

export async function campaignConditionRules(q: Queryable, campaignId: string): Promise<RuleSet> {
  const cached = cache.get(campaignId);
  if (cached) return cached;
  const rows = (await q.query('SELECT code, name, icon, icon_asset_id, kind, description, clauses, stages FROM campaign_conditions WHERE campaign_id=$1', [campaignId])).rows;
  const rules = new Map<string, ConditionRule>(builtInRules());
  for (const row of rows) rules.set(String(row.code), ruleFromRow(row));
  cache.set(campaignId, rules);
  return rules;
}

export function isCustomCode(code: string) {
  return CUSTOM_CODE.test(code);
}

export async function conditionName(q: Queryable, campaignId: string, code: string): Promise<string> {
  const exhaustion = /^exhaustion_([1-6])$/.exec(code);
  if (exhaustion) return `истощение ${exhaustion[1]}`;
  return (await campaignConditionRules(q, campaignId)).get(code)?.name ?? CONDITION_LABELS[code] ?? code;
}
