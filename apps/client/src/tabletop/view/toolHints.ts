import { computed, watch, type Ref, type ComputedRef } from 'vue';
import type { Tabletop, TableTool } from '../scene';
import type { Position, DiagonalRule } from '../grid';
import type { BestiaryPlacement } from '../../components/rules/BestiaryModal.vue';
import type { GameIconName } from '../../ui/gameIcons';
import GameActionBar from '../../components/game/actionBar/GameActionBar.vue';
import type { WallTool } from './types';

export type ToolHintsDeps = {
  placingEncounter: Ref<{ id: string; name: string; members: Array<{ dx: number; dz: number }> } | null>;
  placingBestiary: Ref<BestiaryPlacement | null>;
  actionBar: Ref<InstanceType<typeof GameActionBar> | null>;
  targetingActive: ComputedRef<boolean>;
  pendingPinPoint: Ref<Position | null>;
  templateAsTrigger: Ref<boolean>;
  wallTool: Ref<WallTool | null>;
  terrainMode: Ref<boolean>;
  wallFirstPoint: Ref<Position | null>;
  table: () => Tabletop | undefined;
  movingTemplateId: Ref<string | null>;
  tool: Ref<TableTool>;
  shareRuler: Ref<boolean>;
  diagonalRule: Ref<DiagonalRule>;
  pendingTextPoint: Ref<Position | null>;
  editingTextId: Ref<string | null>;
  movingTextId: Ref<string | null>;
  sendMeasureClear: () => void;
  groupMoveActive: ComputedRef<boolean>;
};

export function useToolHints({ placingEncounter, placingBestiary, actionBar, targetingActive, pendingPinPoint, templateAsTrigger, wallTool, terrainMode, wallFirstPoint, table, movingTemplateId, tool, shareRuler, diagonalRule, pendingTextPoint, editingTextId, movingTextId, sendMeasureClear, groupMoveActive }: ToolHintsDeps) {
  const toolHint = computed(() => {
    if (groupMoveActive.value) return 'Выделено: щёлкните по карте — всё переедет туда, расстановка та же. Стрелки — на клетку, Esc — снять выделение.';
    if (wallTool.value === 'chain') {
      return wallFirstPoint.value
        ? 'Стена: щёлкайте дальше — цепочка продолжается. Щелчок в ту же точку, правый щелчок или Esc — закончить.'
        : 'Стена: щёлкните по узлу сетки — начало цепочки стен. Esc — выйти.';
    }
    if (wallTool.value === 'room') {
      return wallFirstPoint.value ? 'Комната: щёлкните противоположный угол. Esc — отмена.' : 'Комната: щёлкните первый угол прямоугольника. Esc — выйти.';
    }
    if (wallTool.value === 'pick') return 'Правка стен: щёлкните по стене — вид, картинка, удалить. Esc — выйти.';
    if (terrainMode.value) {
      return 'Местность: зажмите и протяните — прямоугольник клеток, щелчок — одна клетка. Начали с отмеченной — снимает. Esc — выйти.';
    }
    if (movingTemplateId.value) return 'Область: щёлкните по столу, куда её переставить. Esc — отмена.';
    if (tool.value === 'measure') {
      const rule = diagonalRule.value === '5-10-5'
        ? 'диагонали 5-10-5 (дополнительное правило)'
        : 'диагонали: каждая клетка — одна';
      return `Линейка: зажмите левую кнопку на клетке и ведите (${rule}). Esc — выйти.`;
    }
    if (tool.value === 'ping') return 'Указка: щелчок по карте покажет место всем участникам сцены. Esc — выйти.';
    if (tool.value === 'draw') return 'Рисование: зажмите левую кнопку и ведите. Рисунок сохраняется со сценой. Esc — выйти.';
    if (tool.value === 'text' && movingTextId.value) return 'Подпись: щёлкните, куда её переставить. Esc — отмена.';
    if (tool.value === 'text') return 'Подпись: щёлкните по карте — новая; по существующей подписи — изменить, переставить или удалить.';
    if (tool.value === 'erase') return 'Ластик: щёлкните по своему рисунку или подписи (мастер стирает любые).';
    if (tool.value === 'pin') return 'Булавка: щёлкните по карте, чтобы приколоть заметку; по булавке — чтобы снять её.';
    if (tool.value === 'template') {
      return 'Область: нажмите в точке начала (узел сетки) и ведите — направление конуса, куба или линии. Esc — выйти.';
    }
    if (tool.value === 'place' && placingBestiary.value) {
      return `Бестиарий: ${placingBestiary.value.label} — щёлкните по клетке, там встанет первый, остальные — вокруг. Esc — отмена.`;
    }
    if (tool.value === 'place') {
      return `Встреча «${placingEncounter.value?.name ?? ''}»: щёлкните по клетке — там встанет её центр. Esc — отмена.`;
    }
    return '';
  });

  const toolOptionsMeta = computed<{ label: string; icon: GameIconName; detail: string }>(() => {
    if (wallTool.value === 'opening') return { label: 'Двери и окна', icon: 'door', detail: 'Щелчок по участку стены — дверь, окно или снова стена' };
    if (wallTool.value) return { label: 'Стены', icon: 'wall', detail: 'Цепочка, комната или правка; вид и картинка' };
    if (terrainMode.value) return { label: 'Местность', icon: 'terrain', detail: 'Путь через клетки — вдвое дороже' };
    if (tool.value === 'template' && templateAsTrigger.value) return { label: 'Ловушка', icon: 'trap', detail: 'Область видит только мастер, срабатывает при входе' };
    if (tool.value === 'measure') return { label: 'Линейка', icon: 'ruler', detail: 'Расстояние и видимость измерения' };
    if (tool.value === 'template') return { label: 'Область', icon: 'burst', detail: 'Форма и размер эффекта' };
    if (tool.value === 'text') return { label: 'Подпись', icon: 'letter', detail: 'Текст и его видимость' };
    if (tool.value === 'erase') return { label: 'Ластик', icon: 'eraser', detail: 'Удаление разметки' };
    return { label: 'Кисть', icon: 'quill', detail: 'Цвет и слой рисунка' };
  });

  watch(tool, next => {
    if (next !== 'select' && targetingActive.value) actionBar.value?.cancelStep();
    table()?.setTool(next);
    if (next !== 'text') {
      pendingTextPoint.value = null;
      editingTextId.value = null;
      movingTextId.value = null;
    }
    if (next !== 'pin') pendingPinPoint.value = null;
    if (next !== 'place') {
      placingEncounter.value = null;
      placingBestiary.value = null;
    }

    if (next !== 'select') {
      wallTool.value = null;
      terrainMode.value = false;
      wallFirstPoint.value = null;
    }
  });

  watch(shareRuler, share => {
    if (!share) sendMeasureClear();
  });

  return { toolHint, toolOptionsMeta };
}
