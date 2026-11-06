export type ChronicleFight = {
  sceneName: string;
  rounds: number;
  participants: Array<{ name: string; side: string; damageDealt: number; kills: number; crits: number; experience: number | null }>;
};

export type ChronicleFacts = {
  date: Date;
  clockFrom?: string | null;
  clockTo?: string | null;
  fights: ChronicleFight[];
  quests: Array<{ title: string; status: 'completed' | 'failed' }>;
  highlights: Array<{ name: string; kind: 'crit' | 'fumble'; target?: string | null }>;
  handouts: string[];
};

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

export function buildRecap(facts: ChronicleFacts): { title: string; body: string } {
  const date = facts.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const title = `Сессия ${date}`;
  const lines: string[] = [];

  if (facts.clockFrom && facts.clockTo && facts.clockFrom !== facts.clockTo) lines.push(`Время в мире: ${facts.clockFrom} → ${facts.clockTo}.`);

  for (const fight of facts.fights) {
    const party = fight.participants.filter(entry => entry.side === 'party');
    const kills = party.reduce((sum, entry) => sum + entry.kills, 0);
    const best = [...party].sort((a, b) => b.damageDealt - a.damageDealt)[0];
    const parts = [`Бой: ${fight.sceneName} — ${fight.rounds} ${plural(fight.rounds, 'раунд', 'раунда', 'раундов')}`];
    if (kills) parts.push(`повержено врагов: ${kills}`);
    if (best && best.damageDealt > 0) parts.push(`больше всех урона — ${best.name} (${best.damageDealt})`);
    lines.push(`${parts.join('; ')}.`);
  }

  const done = facts.quests.filter(quest => quest.status === 'completed').map(quest => `«${quest.title}»`);
  const failed = facts.quests.filter(quest => quest.status === 'failed').map(quest => `«${quest.title}»`);
  if (done.length) lines.push(`Выполнено: ${done.join(', ')}.`);
  if (failed.length) lines.push(`Провалено: ${failed.join(', ')}.`);

  const moments = facts.highlights.slice(0, 6).map(entry => entry.kind === 'crit'
    ? `${entry.name} — критическое попадание${entry.target ? ` по «${entry.target}»` : ''}`
    : `${entry.name} — единица на кубике${entry.target ? ` против «${entry.target}»` : ''}`);
  if (moments.length) lines.push(`Яркие моменты: ${moments.join('; ')}.`);

  if (facts.handouts.length) lines.push(`Найдено и прочитано: ${facts.handouts.map(name => `«${name}»`).join(', ')}.`);

  const experience = new Map<string, number>();
  for (const fight of facts.fights) {
    for (const entry of fight.participants) {
      if (entry.side === 'party' && entry.experience) experience.set(entry.name, (experience.get(entry.name) ?? 0) + entry.experience);
    }
  }
  if (experience.size) lines.push(`Опыт: ${[...experience].map(([name, amount]) => `${name} +${amount}`).join(', ')}.`);

  if (!lines.length) lines.push('Тихая сессия: ни боёв, ни выполненных заданий. Допишите, что было.');
  return { title, body: lines.join('\n') };
}
