import { reactive } from 'vue';
import { assetImageUrl } from '../art/assetImages';
import type { GameIconName } from '../ui/gameIcons';
import type { Clause, ConditionKind, ConditionStage } from '../../../../packages/domain/combat/condition-rules';

export type ConditionRuleView = {
  code: string;
  name: string;
  icon: GameIconName;
  iconAssetId: string | null;
  kind: ConditionKind;
  clauses: Clause[];
  stages: ConditionStage[];
  description: string;
  summary: string;
  standard: boolean;
  // Where the rule comes from: the SRD, a mechanics mod, or the campaign's own.
  origin?: 'srd' | 'mod' | 'campaign';
  modName?: string;
  changed: boolean;
  iconChanged: boolean;
  inUse: number;
  srd?: { clauses: Clause[]; stages: ConditionStage[]; summary: string; icon: GameIconName };
};

type Request = (path: string, method?: string, body?: unknown) => Promise<any>;

// The campaign's condition rules for every place that names or explains a condition (badges, sheet, the conditions panel).
export const campaignConditions = reactive<{ campaignId: string; canEdit: boolean; rules: ConditionRuleView[] }>({ campaignId: '', canEdit: false, rules: [] });

export function setCampaignConditions(campaignId: string, rules: ConditionRuleView[], canEdit = campaignConditions.canEdit) {
  campaignConditions.campaignId = campaignId;
  campaignConditions.canEdit = canEdit;
  campaignConditions.rules = rules;
}

let generation = 0;
let pictures: Request | null = null;
export async function loadCampaignConditions(request: Request, campaignId: string) {
  const mine = ++generation;
  pictures = request;
  if (!campaignId) {
    setCampaignConditions('', [], false);
    return null;
  }
  const data = await request(`/campaigns/${campaignId}/condition-rules`);
  if (mine === generation) setCampaignConditions(campaignId, data.rules, data.canEdit === true);
  return data as { canEdit: boolean; rules: ConditionRuleView[] };
}

export function campaignRule(code: string): ConditionRuleView | undefined {
  return campaignConditions.rules.find(rule => rule.code === code);
}

export function customConditions(): ConditionRuleView[] {
  return campaignConditions.rules.filter(rule => !rule.standard);
}

export function conditionImage(rule: { iconAssetId?: string | null } | undefined): string | null {
  if (!rule?.iconAssetId || !pictures || !campaignConditions.campaignId) return null;
  return assetImageUrl(campaignConditions.campaignId, rule.iconAssetId, pictures);
}
