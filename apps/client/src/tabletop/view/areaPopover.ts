import { fixedFormula } from '../../rules/dice';
import { computed, type Ref, type ComputedRef } from 'vue';
import type { TableTool } from '../scene';
import type { Position } from '../grid';
import type { AreaPopoverTemplate, AreaEditPayload, AreaSavePayload } from '../../components/game/AreaPopover.vue';
import type { TabletopProps } from './types';
import type { TableToast } from '../toasts';
import type { TemplateRow } from '../../components/tabletop/AreaTemplates.vue';

export type AreaPopoverDeps = {
  props: TabletopProps;
  movingTemplateId: Ref<string | null>;
  areaPopover: Ref<{ at: { x: number; y: number }; templateId: string } | null>;
  tool: Ref<TableTool>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  basePath: () => string;
  loadRolls: () => Promise<void>;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  templateRows: ComputedRef<TemplateRow[]>;
  rememberTemplateEdit: (templateId: string, label: string) => void;
};

export function useAreaPopover({ props, movingTemplateId, areaPopover, tool, pushToast, basePath, loadRolls, refresh, run, templateRows, rememberTemplateEdit }: AreaPopoverDeps) {
  const areaPopoverTemplate = computed<(AreaPopoverTemplate & { createdBy: string }) | null>(() => {
    const id = areaPopover.value?.templateId;
    const row = id ? templateRows.value.find(entry => entry.id === id) : null;
    if (!row) return null;
    const shape = ({ circle: 'Круг', cone: 'Конус', square: 'Куб', line: 'Линия' } as Record<string, string>)[row.shape] ?? 'Область';
    return {
      id: row.id, label: row.label || `${shape} ${row.size_feet} фут.`, affected: row.affected, createdBy: row.created_by,
      shape: row.shape, sizeFeet: Number(row.size_feet), widthFeet: row.width_feet == null ? null : Number(row.width_feet),
      direction: Number(row.direction ?? 0), color: row.color, customLabel: row.label ?? '',
    };
  });

  function areaEdit(payload: AreaEditPayload) {
    const template = areaPopoverTemplate.value;
    if (!template) return;
    return run(async () => {
      rememberTemplateEdit(template.id, 'правка области');
      await props.request(`${basePath()}/templates/${template.id}`, 'PATCH', payload);
      await refresh();
    });
  }
  function areaMove() {
    movingTemplateId.value = areaPopover.value?.templateId ?? null;
    areaPopover.value = null;
    tool.value = 'select';
  }
  function moveTemplateTo(point: Position) {
    const id = movingTemplateId.value;
    movingTemplateId.value = null;
    if (!id) return;
    return run(async () => {
      rememberTemplateEdit(id, 'сдвиг области');
      await props.request(`${basePath()}/templates/${id}`, 'PATCH', { x: Math.round(point.x * 2) / 2, z: Math.round(point.z * 2) / 2 });
      await refresh();
    });
  }

  function areaSaves(payload: AreaSavePayload) {
    const template = areaPopoverTemplate.value;
    if (!template) return;
    areaPopover.value = null;
    return run(async () => {
      const result = await props.request(`${basePath()}/templates/${template.id}/saves`, 'POST', { ability: payload.ability, dc: payload.dc });
      const cover = (entry: any) => (entry.cover === 'half' ? ', укрытие +2' : entry.cover === 'three-quarters' ? ', укрытие +5' : '');
      const lines: string[] = [];
      let damageText = '';
      if (payload.damage) {
        const roll = await props.request(`/campaigns/${props.campaignId}/rolls`, 'POST', { formula: payload.damage, label: `Урон: ${template.label}`.slice(0, 100) });
        damageText = ` Урон ${roll.total}.`;
        let half: any = null;
        for (const entry of result.results) {
          let rollId = roll.id;
          if (entry.success) {
            if (!payload.halfOnSave) {
              lines.push(`${entry.name} (${entry.total}${cover(entry)}) — устоял`);
              continue;
            }
            const halfAmount = Math.floor(Math.max(0, roll.total) / 2);
            if (halfAmount < 1) {
              lines.push(`${entry.name} (${entry.total}${cover(entry)}) — устоял, урона нет`);
              continue;
            }
            half ??= await props.request(`/campaigns/${props.campaignId}/rolls`, 'POST', { formula: fixedFormula(halfAmount), label: `Половина урона: ${template.label}`.slice(0, 100) });
            rollId = half.id;
          }
          const applied = await props.request(`/campaigns/${props.campaignId}/rolls/${rollId}/apply`, 'POST', {
            characterId: entry.characterId, mode: 'damage', ...(payload.damageType ? { damageType: payload.damageType } : {}),
          });
          lines.push(`${entry.name} (${entry.autoFail ? 'автопровал' : entry.total}${cover(entry)}) — ${applied.applied}${entry.success ? ' ½' : ''}`);
        }
      } else {
        for (const entry of result.results) lines.push(`${entry.name}: ${entry.success ? 'успех' : 'провал'} (${entry.autoFail ? 'автопровал' : entry.total}${cover(entry)})`);
      }
      pushToast({ tone: 'info', title: `${template.label}: спасброски, СЛ ${payload.dc}`, detail: `${lines.join('; ') || 'никого не задело'}.${damageText}` }, 14000);
      await loadRolls();
      await refresh();
    });
  }

  return { areaPopoverTemplate, areaEdit, areaMove, moveTemplateTo, areaSaves };
}
