import type { RollGroup } from '../rules/dice';
import type { RollOutcome } from '../rules/conditions';
import type { ChatMessage } from '../campaign/chat';

export type RollEntry = {
  id: string;
  user_id: string;
  character_id: string | null;
  label: string | null;
  formula: string;
  dice_results: number[];
  total: number;
  hidden: boolean;
  created_at: string;
  user_display_name?: string | null;
  breakdown?: RollGroup[] | null;
  outcome?: RollOutcome | null;
  applied_to?: string[] | null;
};

export type GameLogProps = {
  rolls: RollEntry[];
  characterNames: Record<string, string>;
  currentUserId: string;
  canHide: boolean;
  busy: boolean;
  chat?: ChatMessage[];
  speaker?: { characterId: string; name: string } | null;
  members?: Array<{ userId: string; displayName: string }>;
  resizable?: boolean;
  applyTargets?: Array<{ id: string; name: string }>;
  defaultTargetId?: string | null;
};

export type GameLogEvents = {
  roll: [{ formula: string; label: string; hidden: boolean }];
  say: [{ body: string; inCharacter: boolean; characterId?: string; toUserId?: string }];
  applyRoll: [{ rollId: string; characterId: string; mode: 'damage' | 'heal'; critical?: boolean; damageType?: string }];
};


type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;
export type GameLogEmit = UnionToIntersection<{ [K in keyof GameLogEvents]: (event: K, ...args: GameLogEvents[K]) => void }[keyof GameLogEvents]>;
