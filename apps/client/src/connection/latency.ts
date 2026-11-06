import { ref } from 'vue';

export const liveLatencyMs = ref<number | null>(null);

export function latencyTone(ms: number | null): 'good' | 'fair' | 'slow' | 'none' {
  if (ms === null) return 'none';
  if (ms <= 20) return 'good';
  if (ms <= 80) return 'fair';
  return 'slow';
}
