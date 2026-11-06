import { findFormulas, normalizeFormula } from '../rules/dice';

export type ChatMessage = {
  id: string;
  user_id: string;
  user_name: string;
  character_id: string | null;
  character_name: string | null;
  to_user_id: string | null;
  to_user_name: string | null;
  in_character: boolean;
  body: string;
  created_at: string;
};

export function parseChatInput(text: string): { kind: 'roll'; formula: string } | { kind: 'say'; body: string } | null {
  const value = text.trim();
  if (!value) return null;
  const command = /^\/r(?:oll)?\s+(.+)$/i.exec(value);
  if (command) return { kind: 'roll', formula: command[1]!.trim() };
  const compact = normalizeFormula(value.replace(/\s+/g, ''));
  const found = findFormulas(compact);
  if (found.length === 1 && found[0] === compact) return { kind: 'roll', formula: compact };
  return { kind: 'say', body: value };
}
