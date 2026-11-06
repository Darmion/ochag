import type { SpellTemplate, Suggestion, actionParts } from '../../../../packages/domain/spells/spell-template.ts';

export type SuggestionState = Suggestion & { status: 'suggested' | 'accepted' | 'manual' | 'cleared' };
export type View = {
  spell: { id: string; name: string; status: string; createdBy: string; authorName: string | null; template: SpellTemplate | null; templateVersion: number;
    specialNotify: boolean; reviewNote: string | null; desc: string; higherLevel: string | null; level: number; school: string; suggestions: { items?: SuggestionState[] } | null };
  proposal: { id: string; status: string; template: SpellTemplate; note: string | null; submittedByName: string | null } | null;
  history: Array<{ version: number; status: string; submittedByName: string | null; reviewedAt: string | null; note: string | null }>;
  canEdit: boolean;
  canReview: boolean;
};
export type SrdView = { overridden: boolean; canEdit: boolean; templateVersion: number; specialNotify: boolean };
export type Segment = { text: string; user?: boolean };
export type Block = { key: string; scope: string; scopeUser: boolean; section: string; depth: number; name: string; parts: ReturnType<typeof actionParts> };
