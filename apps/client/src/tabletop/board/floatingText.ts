import { Vector3 } from '@babylonjs/core';
import type { LabelApi, OverlayLabel } from './labels';
import type { ObjectRecord } from '../sceneTypes';

export type FloatingTextDeps = Pick<LabelApi, 'createLabel' | 'removeLabel' | 'setLabelText'> & {
  reducedMotion: boolean;
  objectEntries: Map<string, ObjectRecord>;
};

export function createFloatingText({
  reducedMotion, createLabel, setLabelText, removeLabel, objectEntries,
}: FloatingTextDeps) {
  const floatingSteps = new Map<string, Set<number>>();
  const floatingTimers = new Set<ReturnType<typeof setTimeout>>();

  function showFloatingText(objectId: string, text: string, tone: 'damage' | 'heal' | 'miss' | 'crit' | 'condition' | 'info' | 'xp' | 'level') {
    const record = objectEntries.get(objectId);
    if (!record) return;
    const anchor = new Vector3();
    const label = createLabel(`floating-text tone-${tone}${reducedMotion ? ' no-motion' : ''}`, () => {
      const current = objectEntries.get(objectId);
      if (!current || !current.holder.isEnabled()) return null;
      const { position, scaling } = current.holder;
      return anchor.set(position.x, position.y + current.content.labelHeight * scaling.y + 0.35, position.z);
    });
    if (!label) return;
    const taken = floatingSteps.get(objectId) ?? new Set<number>();
    let step = 0;
    while (taken.has(step)) step += 1;
    taken.add(step);
    floatingSteps.set(objectId, taken);
    label.el.style.setProperty('--float-step', String(step));
    setLabelText(label, text);
    const timer = setTimeout(() => {
      floatingTimers.delete(timer);
      removeLabel(label);
      taken.delete(step);
      if (!taken.size) floatingSteps.delete(objectId);
    }, reducedMotion ? 2200 : 1700);
    floatingTimers.add(timer);
  }

  const speech = new Map<string, { label: OverlayLabel; timer: ReturnType<typeof setTimeout> }>();
  function showSpeech(objectId: string, text: string) {
    const record = objectEntries.get(objectId);
    if (!record) return;
    const previous = speech.get(objectId);
    if (previous) {
      clearTimeout(previous.timer);
      removeLabel(previous.label);
    }
    const anchor = new Vector3();
    const label = createLabel('speech-bubble', () => {
      const current = objectEntries.get(objectId);
      if (!current || !current.holder.isEnabled()) return null;
      const { position, scaling } = current.holder;
      return anchor.set(position.x, position.y + current.content.labelHeight * scaling.y + 0.55, position.z);
    });
    if (!label) return;
    label.el.translate = false;
    setLabelText(label, text.length > 140 ? `${text.slice(0, 137)}…` : text);
    const timer = setTimeout(() => {
      removeLabel(label);
      speech.delete(objectId);
    }, Math.min(12000, 3500 + text.length * 60));
    speech.set(objectId, { label, timer });
  }

  function stopFloatingText() {
    for (const timer of floatingTimers) clearTimeout(timer);
    floatingTimers.clear();
    floatingSteps.clear();
    for (const entry of speech.values()) clearTimeout(entry.timer);
    speech.clear();
  }

  return { showFloatingText, showSpeech, stopFloatingText };
}
