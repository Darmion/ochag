export function collectKeys(root?: string): string[];
export function collectKeyFiles(root?: string): Map<string, { file: string; at: number; plural: boolean }>;
export function keysModule(keys: string[]): string;
export function readEnglish(): Record<string, unknown>;
