import { DAMAGE_TYPES, type Option, SKILLS } from './options.ts';
import type { Outcome } from './types.ts';

export const MOD_MODES: readonly Option[] = [['die', '+ кость'], ['minus-die', '− кость'], ['plus', '+ число'], ['minus', '− число'], ['advantage', 'преимущество'], ['disadvantage', 'помеха']];
export const SKILL_OR_NONE: readonly Option[] = [['none', '—'], ...SKILLS];
export const DAMAGE_TYPE_CHOICES: readonly Option[] = [...DAMAGE_TYPES, ['param', 'из параметра'], ['weapon', 'как у оружия']];
export const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const OUTCOMES: readonly Outcome[] = ['always', 'hit', 'miss', 'crit', 'fail', 'success', 'met', 'unmet'];
