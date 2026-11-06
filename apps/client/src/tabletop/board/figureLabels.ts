import { Vector3 } from '@babylonjs/core';
import type { LabelApi } from './labels';
import type { ObjectRecord, PlacedObject } from '../sceneTypes';

export type FigureLabelsDeps = Pick<LabelApi, 'createLabel' | 'setLabelText' | 'setLabelClass'> & {
  objectEntries: Map<string, ObjectRecord>;
  selectedObjectId: () => string | null;
  inAnyTemplate: (record: { data: PlacedObject; }) => boolean;
};

export function createFigureLabels({
  setLabelText, setLabelClass, createLabel, objectEntries, selectedObjectId, inAnyTemplate,
}: FigureLabelsDeps) {
  function labelClass(record: ObjectRecord) {
    const { data } = record;
    return [
      data.creature ? 'token-label' : 'object-label',
      `side-${data.side}`,
      data.current ? 'is-current' : '',
      data.id === selectedObjectId() ? 'is-selected' : '',
      data.hidden ? 'is-hidden' : '',
      data.dead ? 'is-dead' : '',
      inAnyTemplate(record) ? 'is-in-area' : '',
    ].filter(Boolean).join(' ');
  }

  function refreshLabel(objectId: string) {
    const record = objectEntries.get(objectId);
    if (!record) return;
    const mark = record.data.current ? 'swords' : record.data.dead ? 'skull' : null;
    setLabelText(record.label, record.data.name, { before: mark ? [mark] : [], after: record.data.icons });
    setLabelClass(record.label, labelClass(record));
  }

  function labelPriority(objectId: string): number {
    const data = objectEntries.get(objectId)?.data;
    if (!data) return 0;
    if (data.current) return 3;
    if (objectId === selectedObjectId()) return 2;
    return data.dead ? 0 : 1;
  }

  function makeLabel(objectId: string) {
    const anchor = new Vector3();

    return createLabel('token-label', () => {
      const record = objectEntries.get(objectId);
      if (!record || !record.holder.isEnabled()) return null;
      if (!record.data.creature && objectId !== selectedObjectId()) return null;

      const { position, scaling } = record.holder;
      return anchor.set(position.x, position.y + record.content.labelHeight * scaling.y + 0.04, position.z);
    }, { id: objectId, part: 'name', priority: () => labelPriority(objectId) });
  }

  let showHitPoints = true;

  function makeHpBar(objectId: string) {
    const anchor = new Vector3();
    const label = createLabel('hp-bar', () => {
      const record = objectEntries.get(objectId);
      const hp = record?.data.hp;
      if (!showHitPoints || !record || !hp || hp.max <= 0 || !record.holder.isEnabled()) return null;
      if (!record.data.creature && objectId !== selectedObjectId() && hp.current >= hp.max) return null;
      const { position, scaling } = record.holder;
      return anchor.set(position.x, position.y + record.content.labelHeight * scaling.y + 0.04, position.z);
    }, { id: objectId, part: 'hp', priority: () => labelPriority(objectId) });

    if (label) {
      label.el.innerHTML = '<span class="hp-fill"></span><span class="hp-temp"></span><span class="hp-text"></span>';
    }

    return label;
  }

  function refreshHpBar(record: ObjectRecord) {
    const bar = record.hpBar;
    const hp = record.data.hp;
    if (!bar || !hp || hp.max <= 0) return;

    const ratio = Math.max(0, Math.min(1, hp.current / hp.max));
    const fill = bar.el.querySelector<HTMLElement>('.hp-fill');
    const temp = bar.el.querySelector<HTMLElement>('.hp-temp');
    const text = bar.el.querySelector<HTMLElement>('.hp-text');
    const state = ratio > 0.5 ? 'hp-high' : ratio > 0.25 ? 'hp-mid' : 'hp-low';

    setLabelClass(bar, `hp-bar ${state}`);
    if (fill) fill.style.width = `${Math.round(ratio * 100)}%`;
    if (temp) temp.style.width = hp.temp > 0 ? `${Math.min(40, Math.round((hp.temp / hp.max) * 100))}%` : '0';
    const caption = `${hp.current}/${hp.max}${hp.temp > 0 ? ` +${hp.temp}` : ''}`;
    if (text && text.textContent !== caption) text.textContent = caption;
  }

  function setShowHitPoints(show: boolean) {
    showHitPoints = show;
  }

  return { refreshLabel, makeLabel, makeHpBar, refreshHpBar, setShowHitPoints };
}
