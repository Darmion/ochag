import type { Ref, ComputedRef } from 'vue';
import { type Position, gridDistanceCells, type DiagonalRule } from '../grid';
import type { LiveConnection } from '../live';
import { formatFeet } from '../toasts';

export type MeasureShareDeps = {
  feetPerUnit: ComputedRef<number>;
  live: () => LiveConnection | undefined;
  shareRuler: Ref<boolean>;
  diagonalRule: Ref<DiagonalRule>;
};

export function useMeasureShare({ feetPerUnit, live, shareRuler, diagonalRule }: MeasureShareDeps) {
  function measureLabel(from: Position, to: Position) {
    const cells = gridDistanceCells(from, to, diagonalRule.value);
    return `${formatFeet(cells * feetPerUnit.value)} фт · ${cells} кл.`;
  }

  // At most ~15 steps a second, and the last one always goes out, or others' rulers stop short.
  const MEASURE_SEND_MS = 66;
  let measureSendTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingMeasure: { from: Position; to: Position } | null = null;
  let lastMeasureSentAt = 0;

  function flushMeasure() {
    clearTimeout(measureSendTimer);
    measureSendTimer = undefined;
    if (!pendingMeasure) return;

    live()?.send({ type: 'measure', from: pendingMeasure.from, to: pendingMeasure.to });
    pendingMeasure = null;
    lastMeasureSentAt = Date.now();
  }

  function sendMeasure(from: Position, to: Position) {
    if (!shareRuler.value) return;

    pendingMeasure = { from, to };
    const wait = MEASURE_SEND_MS - (Date.now() - lastMeasureSentAt);

    if (wait <= 0) flushMeasure();
    else if (!measureSendTimer) measureSendTimer = setTimeout(flushMeasure, wait);
  }

  function dropMeasure() {
    clearTimeout(measureSendTimer);
    measureSendTimer = undefined;
    pendingMeasure = null;
  }

  function sendMeasureClear() {
    dropMeasure();
    live()?.send({ type: 'measure-clear' });
  }

  return { measureLabel, sendMeasure, dropMeasure, sendMeasureClear };
}
