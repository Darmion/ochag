export type DialogueCheck = { skill: string; dc: number; success: string | null; failure: string | null };
export type DialogueOption = { id: string; label: string; next: string | null; check?: DialogueCheck | null };
export type DialogueNode = { id: string; speaker?: string | null; text: string; options: DialogueOption[] };

export const DIALOGUE_LIMITS = { nodes: 100, options: 8, text: 2000, label: 200, id: 40 };

const ID = /^[A-Za-z0-9_-]{1,40}$/;

export function dialogueProblems(nodes: DialogueNode[], start: string, isSkill: (skill: string) => boolean): string[] {
  const problems: string[] = [];
  if (!nodes.length) return ['В разговоре нет ни одной реплики.'];
  if (nodes.length > DIALOGUE_LIMITS.nodes) problems.push(`Реплик больше ${DIALOGUE_LIMITS.nodes}.`);
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!ID.test(node.id)) problems.push(`Неверный код реплики «${node.id}».`);
    if (ids.has(node.id)) problems.push(`Код реплики «${node.id}» повторяется.`);
    ids.add(node.id);
  }
  if (!ids.has(start)) problems.push(`Начальной реплики «${start}» нет.`);
  const target = (where: string, next: string | null) => {
    if (next !== null && !ids.has(next)) problems.push(`${where}: ведёт к реплике «${next}», которой нет.`);
  };
  for (const node of nodes) {
    if (!node.text.trim()) problems.push(`Реплика «${node.id}» пустая.`);
    if (node.text.length > DIALOGUE_LIMITS.text) problems.push(`Реплика «${node.id}» длиннее ${DIALOGUE_LIMITS.text} знаков.`);
    if (node.options.length > DIALOGUE_LIMITS.options) problems.push(`У реплики «${node.id}» больше ${DIALOGUE_LIMITS.options} ответов.`);
    const optionIds = new Set<string>();
    for (const option of node.options) {
      const where = `Ответ «${option.label}» в «${node.id}»`;
      if (!ID.test(option.id) || optionIds.has(option.id)) problems.push(`${where}: неверный или повторный код.`);
      optionIds.add(option.id);
      if (!option.label.trim() || option.label.length > DIALOGUE_LIMITS.label) problems.push(`${where}: пустой или слишком длинный текст.`);
      if (option.check) {
        if (!isSkill(option.check.skill)) problems.push(`${where}: неизвестный навык «${option.check.skill}».`);
        if (!Number.isInteger(option.check.dc) || option.check.dc < 1 || option.check.dc > 40) problems.push(`${where}: СЛ — от 1 до 40.`);
        target(`${where} (успех)`, option.check.success);
        target(`${where} (провал)`, option.check.failure);
      } else {
        target(where, option.next);
      }
    }
  }
  return problems;
}

export function nextNode(option: DialogueOption, success: boolean | null): string | null {
  if (option.check) return success ? option.check.success : option.check.failure;
  return option.next;
}
