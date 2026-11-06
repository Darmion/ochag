import { ref } from 'vue';

export const updateState = ref<UpdateState | null>(null);
export const githubUpdate = ref<GitHubUpdate | null>(null);

export async function refreshUpdateState() {
  if (!window.desktop) return null;
  updateState.value = await window.desktop.updates.state();
  return updateState.value;
}

export async function autoCheckGitHub() {
  const state = await refreshUpdateState().catch(() => null);
  if (!window.desktop || !state?.repository || !state.autoCheck) return;

  try {
    githubUpdate.value = await window.desktop.updates.checkGitHub();
  } catch {
    githubUpdate.value = null;
  }
}

export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const parse = (value: string | null | undefined) => /(\d+)\.(\d+)\.(\d+)/.exec(value ?? '')?.slice(1, 4).map(Number);
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;

  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }

  return 0;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}
