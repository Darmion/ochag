import { ref, computed, type Ref } from 'vue';
import { KNOWN_FLAGS, type CampaignRule, RULE_KIND_LABELS, RULE_KINDS } from '../campaign/campaignRules';
import { type RuleSort, type TopicFilter, normalizeSearch, type RuleTopic, ruleTopic, topicLabel, compareTopics, compareLabels } from './topics';

export type RuleFiltersDeps = {
  rules: Ref<CampaignRule[]>;
  knownFlagValue: (flag: (typeof KNOWN_FLAGS)[number]) => boolean;
};

export function useRuleFilters({ rules, knownFlagValue }: RuleFiltersDeps) {
  const searchQuery = ref('');
  const ruleSort = ref<RuleSort>('topic');
  const topicFilter = ref<TopicFilter>('all');

  const normalizedQuery = computed(() => normalizeSearch(searchQuery.value));

  function matchesSearch(values: unknown[]) {
    const query = normalizedQuery.value;
    return !query || values.some(value => normalizeSearch(value).includes(query));
  }

  const topicMatches = (topic: RuleTopic) => topicFilter.value === 'all' || topicFilter.value === topic;
  const topicForFlag = (flag: typeof KNOWN_FLAGS[number]) => ruleTopic(flag.key, flag.label, flag.description);
  const topicForRule = (rule: CampaignRule) => ruleTopic(rule.key, rule.label, rule.description);

  const visibleFlags = computed(() => KNOWN_FLAGS
    .filter(flag => topicMatches(topicForFlag(flag)) && matchesSearch([
      flag.label,
      flag.description,
      flag.key,
      topicLabel(topicForFlag(flag)),
      knownFlagValue(flag) ? 'включено активно' : 'выключено неактивно',
    ]))
    .sort((left, right) => {
      if (ruleSort.value === 'topic') return compareTopics(topicForFlag(left), topicForFlag(right)) || compareLabels(left.label, right.label);
      if (ruleSort.value === 'label-desc') return compareLabels(right.label, left.label);
      if (ruleSort.value === 'key') return compareLabels(left.key, right.key);
      if (ruleSort.value === 'updated') {
        const leftDate = rules.value.find(rule => rule.key === left.key)?.updated_at ?? '';
        const rightDate = rules.value.find(rule => rule.key === right.key)?.updated_at ?? '';
        return Date.parse(rightDate) - Date.parse(leftDate) || compareLabels(left.label, right.label);
      }
      return compareLabels(left.label, right.label);
    }));

  const visibleRules = computed(() => {
    const result = rules.value.filter(rule => topicMatches(topicForRule(rule)) && matchesSearch([
      rule.label,
      rule.description,
      rule.key,
      topicLabel(topicForRule(rule)),
      RULE_KIND_LABELS[rule.kind],
      rule.value,
      rule.updated_by_name,
    ]));
    const byLabel = (left: CampaignRule, right: CampaignRule) => compareLabels(left.label, right.label);
    return result.sort((left, right) => {
      if (ruleSort.value === 'topic') return compareTopics(topicForRule(left), topicForRule(right)) || byLabel(left, right);
      if (ruleSort.value === 'label-desc') return byLabel(right, left);
      if (ruleSort.value === 'kind') return RULE_KINDS.indexOf(left.kind) - RULE_KINDS.indexOf(right.kind) || byLabel(left, right);
      if (ruleSort.value === 'key') return left.key.localeCompare(right.key, 'ru', { sensitivity: 'base' });
      if (ruleSort.value === 'updated') return Date.parse(right.updated_at) - Date.parse(left.updated_at) || byLabel(left, right);
      return byLabel(left, right);
    });
  });

  function clearSearch() {
    searchQuery.value = '';
  }

  function clearFilters() {
    searchQuery.value = '';
    topicFilter.value = 'all';
  }

  return { searchQuery, ruleSort, topicFilter, topicForFlag, topicForRule, visibleFlags, visibleRules, clearSearch, clearFilters };
}
