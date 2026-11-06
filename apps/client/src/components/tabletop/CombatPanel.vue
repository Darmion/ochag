<script setup lang="ts">
import { AUTO_PACES, AUTO_TARGETS, autoPace, type AutoTarget } from '../../tabletop/autoTarget';
import { computed, ref } from 'vue';
import { describeGroups, type RollGroup } from '../../rules/dice';
import { DAMAGE_TYPES } from '../../rules/objectRules';
import { outcomeText, type RollOutcome } from '../../rules/conditions';
import { naturalMark } from '../../tabletop/toasts';
import GameIcon from '../game/GameIcon.vue';

type RollEntry = {
  id: string;
  user_id: string;
  character_id: string | null;
  label: string | null;
  formula: string;
  dice_results: number[];
  modifier: number;
  total: number;
  hidden: boolean;
  created_at: string;
  user_display_name?: string | null;
  breakdown?: RollGroup[] | null;
  outcome?: RollOutcome | null;
  applied_to?: string[];
};

type InitiativeEntry = {
  id: string;
  character_id: string | null;
  name: string;
  score: number;
  is_current: boolean;
  moved_feet?: number;
  action_used?: boolean;
  bonus_used?: boolean;
  reaction_used?: boolean;
  disengaged?: boolean;
  dashes?: number;
  speed_feet?: number | null;
};

type Character = { id: string; name: string; kind?: string; can_control?: boolean };

const props = defineProps<{
  rolls: RollEntry[];
  entries: InitiativeEntry[];
  combatRound: number;
  characters: Character[];
  currentUserId: string;
  canManage: boolean;
  busy: boolean;
  autoTarget?: AutoTarget;
  slim?: boolean;
}>();

const emit = defineEmits<{
  roll: [{ formula: string; label: string; characterId: string; hidden: boolean }];
  join: [characterId: string];
  addNpc: [{ name: string; score: number }];
  advance: [];
  endCombat: [];
  startCombat: [];
  restParty: [kind: 'short' | 'long'];
  beginRest: [kind: 'short' | 'long'];
  awardParty: [amount: number];
  act: [entryId: string, action: 'disengage' | 'dodge'];
  autoTurn: [];
  autoTarget: [mode: AutoTarget];
  summary: [];
  economy: [entryId: string, field: 'action' | 'bonus' | 'reaction', used: boolean];
  deleteEntry: [entryId: string];
  dash: [entryId: string];
  applyRoll: [{ rollId: string; characterId: string; mode: 'damage' | 'heal'; critical?: boolean; damageType?: string }];
}>();

const partyXp = ref(100);
const rollFormula = ref('1d20');
const rollLabel = ref('');
const rollCharacterId = ref('');
const rollHidden = ref(false);
const applyTargetId = ref('');
const applyTargets = computed(() => (props.canManage ? props.characters : props.characters.filter(character => character.can_control)));
const applyDamageType = ref('');
const applyCritical = ref(false);

const npcName = ref('');
const npcScore = ref(10);

const joinCharacterId = ref('');

const joinable = computed(() => props.characters.filter(c => c.kind !== 'object' && c.can_control !== false));

function submitRoll() {
  if (!rollFormula.value.trim()) return;

  emit('roll', {
    formula: rollFormula.value.trim(),
    label: rollLabel.value.trim(),
    characterId: rollCharacterId.value,
    hidden: rollHidden.value,
  });

  rollLabel.value = '';
}

function submitJoin() {
  if (!joinCharacterId.value) return;
  emit('join', joinCharacterId.value);
}

function submitNpc() {
  if (!npcName.value.trim()) return;
  emit('addNpc', { name: npcName.value.trim(), score: npcScore.value });
  npcName.value = '';
}

function mayDash(entry: InitiativeEntry) {
  return props.characters.some(character => character.id === entry.character_id && character.can_control);
}

function characterName(characterId: string | null): string {
  if (!characterId) return '';
  return props.characters.find(c => c.id === characterId)?.name ?? '';
}

function alreadyApplied(roll: RollEntry): boolean {
  return !!applyTargetId.value && (roll.applied_to ?? []).includes(applyTargetId.value);
}

function applyRoll(rollId: string, mode: 'damage' | 'heal') {
  if (!applyTargetId.value) return;
  emit('applyRoll', {
    rollId, characterId: applyTargetId.value, mode,
    ...(mode === 'damage' && applyCritical.value ? { critical: true } : {}),
    ...(mode === 'damage' && applyDamageType.value ? { damageType: applyDamageType.value } : {}),
  });
}
</script>

<template>
  <div class="combat-panel">
    <template v-if="!slim">
    <p class="eyebrow">Броски</p>

    <details open>
      <summary>Бросить кубики</summary>

      <label>
        Формула: 1d20+3, 1d8+1d6+2, 4d6kh3, 2d6! (взрывающиеся), d20+@str (переменные — от имени персонажа)
        <input v-model="rollFormula" maxlength="100" :disabled="busy" />
      </label>

      <label>
        Подпись
        <input v-model="rollLabel" maxlength="100" placeholder="Например: Проверка Атлетики" :disabled="busy" />
      </label>

      <label>
        От имени персонажа (необязательно)
        <select v-model="rollCharacterId" :disabled="busy">
          <option value="">— без привязки —</option>
          <option v-for="character in characters" :key="character.id" :value="character.id">
            {{ character.name }}
          </option>
        </select>
      </label>

      <label class="checkbox-label">
        <input type="checkbox" v-model="rollHidden" :disabled="busy" />
        Скрытый бросок (видит только мастер и вы)
      </label>

      <button type="button" :disabled="busy || !rollFormula.trim()" @click="submitRoll">
        Бросить
      </button>
    </details>

    <template v-if="applyTargets.length">
    <label>
      Цель для урона/лечения
      <select v-model="applyTargetId" :disabled="busy">
        <option value="">— не выбрана —</option>
        <option v-for="character in applyTargets" :key="character.id" :value="character.id">
          {{ character.name }}
        </option>
      </select>
    </label>

    <label>
      Тип урона
      <select v-model="applyDamageType" :disabled="busy">
        <option value="">— не важен —</option>
        <option v-for="type in DAMAGE_TYPES" :key="type.id" :value="type.id">{{ type.label }}</option>
      </select>
    </label>

    <label class="checkbox-label">
      <input type="checkbox" v-model="applyCritical" :disabled="busy" />
      Критический удар (кнопка «Урон» удвоит кости)
    </label>
    </template>

    <ul class="roll-feed">
      <li v-for="roll in rolls" :key="roll.id">
        <strong :class="naturalMark(roll)?.kind">{{ naturalMark(roll)?.text ?? roll.total }}</strong>
        <span v-if="naturalMark(roll)?.total != null" class="muted"> (итог {{ naturalMark(roll)!.total }})</span>
        <span class="muted"> = {{ roll.formula }} ({{ roll.breakdown?.length ? describeGroups(roll.breakdown) : roll.dice_results.join(', ') }})</span>
        <span v-if="roll.label"> — {{ roll.label }}</span>
        <span v-if="characterName(roll.character_id)"> · {{ characterName(roll.character_id) }}</span>
        <span v-else-if="roll.user_display_name" class="muted"> · {{ roll.user_display_name }}</span>
        <span v-if="roll.hidden" class="tag">скрыто</span>
        <span v-if="outcomeText(roll.outcome)" class="tag outcome" :class="{ good: roll.outcome?.hit || roll.outcome?.success, bad: roll.outcome?.hit === false || roll.outcome?.success === false || roll.outcome?.autoFail }">{{ outcomeText(roll.outcome) }}</span>
        <small v-if="roll.outcome?.reasons?.length" class="muted reasons">{{ roll.outcome.reasons.join('; ') }}</small>
        <span v-if="applyTargets.length" class="apply-buttons">
          <button type="button" :disabled="busy || !applyTargetId || alreadyApplied(roll)" @click="applyRoll(roll.id, 'damage')">Урон</button>
          <button type="button" :disabled="busy || !applyTargetId || alreadyApplied(roll)" @click="applyRoll(roll.id, 'heal')">Лечение</button>
          <span v-if="alreadyApplied(roll)" class="tag" title="Этот бросок уже применён к выбранной цели — выберите другую, если нужно разнести урон/лечение дальше.">уже применено этой цели</span>
        </span>
      </li>
      <li v-if="!rolls.length" class="muted">Пока никто не бросал кубики.</li>
    </ul>
    </template>

    <p class="eyebrow">Инициатива · раунд {{ combatRound }}</p>

    <label>
      Вступить в бой персонажем
      <select v-model="joinCharacterId" :disabled="busy">
        <option value="">Выберите персонажа или НПС</option>
        <option v-for="character in joinable" :key="character.id" :value="character.id">
          {{ character.name }}
        </option>
      </select>
    </label>

    <button type="button" :disabled="busy || !joinCharacterId" @click="submitJoin">
      Вступить в бой (1d20 + ЛОВ)
    </button>

    <details v-if="canManage && !slim">
      <summary>Добавить НПС</summary>

      <label>
        Имя
        <input v-model="npcName" maxlength="100" :disabled="busy" />
      </label>

      <label>
        Инициатива
        <input type="number" v-model.number="npcScore" :disabled="busy" />
      </label>

      <button type="button" :disabled="busy || !npcName.trim()" @click="submitNpc">
        Добавить
      </button>
    </details>

    <ol class="initiative-list">
      <li
        v-for="entry in entries"
        :key="entry.id"
        :class="{ 'is-current': entry.is_current }"
      >
        <span class="score">{{ entry.score }}</span>
        <span class="name">{{ entry.name }}</span>
        <span v-if="entry.character_id && entry.action_used !== undefined" class="economy" aria-label="Действие, бонусное действие, реакция">
          <button
            v-for="pip in ([['action', '●', 'Действие'], ['bonus', '▲', 'Бонусное действие'], ['reaction', '⟲', 'Реакция']] as const)"
            :key="pip[0]" type="button" class="pip" :class="{ spent: entry[`${pip[0]}_used`] }"
            :disabled="busy || !(canManage || (mayDash(entry) && !entry[`${pip[0]}_used`]))"
            :title="`${pip[2]}: ${entry[`${pip[0]}_used`] ? 'потрачено' : 'есть'}${canManage ? ' — щелчок меняет' : ''}`"
            @click="emit('economy', entry.id, pip[0], !entry[`${pip[0]}_used`])"
          >{{ pip[1] }}</button>
        </span>
        <span v-if="entry.is_current && entry.character_id && entry.speed_feet" class="movement muted" title="Пройдено в этот ход из скорости (с Рывками)">
          {{ entry.moved_feet ?? 0 }}/{{ (entry.speed_feet ?? 0) * (1 + (entry.dashes ?? 0)) }} фут.
        </span>
        <button
          v-if="entry.is_current && entry.character_id && entry.speed_feet && (canManage || mayDash(entry))"
          type="button"
          :disabled="busy"
          title="Рывок: ещё столько же движения в этот ход"
          @click="emit('dash', entry.id)"
        >
          Рывок
        </button>
        <span v-if="entry.is_current && entry.character_id && (canManage || mayDash(entry))" class="entry-actions">
          <button type="button" :disabled="busy" title="Отход: уход из досягаемости в этот ход не провоцирует атак" @click="emit('act', entry.id, 'disengage')">Отход</button>
          <button type="button" :disabled="busy" title="Уклонение: до начала своего хода атаки по нему с помехой, спасброски ЛОВ с преимуществом" @click="emit('act', entry.id, 'dodge')">Уклонение</button>
        </span>
        <button
          v-if="canManage || entry.character_id"
          type="button"
          :disabled="busy"
          @click="emit('deleteEntry', entry.id)"
        >
          Убрать
        </button>
      </li>
      <li v-if="!entries.length" class="muted">Бой ещё не начат.</li>
    </ol>

    <div v-if="canManage" class="combat-controls">
      <button
        type="button" class="primary" :disabled="busy"
        :title="entries.length ? 'Добавить в бой всех на сцене, кого в нём ещё нет' : 'Инициатива всем существам на сцене сразу; первый ход начнётся сам'"
        @click="emit('startCombat')"
      >
        {{ entries.length ? 'В бой всех на сцене' : 'Начать бой (все на сцене)' }}
      </button>
      <template v-if="entries.length">
        <template v-if="entries.find(entry => entry.is_current)?.character_id && characters.some(character => character.id === entries.find(entry => entry.is_current)?.character_id && character.kind === 'npc')">
          <select
            :value="autoTarget ?? 'nearest'" :disabled="busy" aria-label="Кого бьёт «Авто-ход»" title="Кого НПС выбирает целью"
            @change="emit('autoTarget', ($event.target as HTMLSelectElement).value as AutoTarget)"
          >
            <option v-for="mode in AUTO_TARGETS" :key="mode.id" :value="mode.id">{{ mode.label }} — {{ mode.hint }}</option>
          </select>
          <select v-model="autoPace" :disabled="busy" aria-label="Темп «Авто-хода»" title="Темп «Авто-хода»: паузы, чтобы было видно, кто куда пошёл и кого ударил">
            <option v-for="pace in AUTO_PACES" :key="pace.id" :value="pace.id">{{ pace.label }} — {{ pace.hint }}</option>
          </select>
          <button type="button" :disabled="busy" title="НПС подходит к цели, бьёт оружием или заклинанием и передаёт ход" @click="emit('autoTurn')">
            Авто-ход НПС
          </button>
        </template>
        <button type="button" :disabled="busy" @click="emit('advance')">
          Дальше ход
        </button>
        <button type="button" :disabled="busy" @click="emit('endCombat')">
          Завершить бой
        </button>
      </template>
      <template v-else>
        <button type="button" :disabled="busy" title="Отряд на сцене тратит кости хитов, сколько нужно; ресурсы «до короткого отдыха»" @click="emit('restParty', 'short')">
          <GameIcon class="inline-icon" name="cup" :size="16" /> Короткий отдых отряда
        </button>
        <button type="button" :disabled="busy" title="Отряд на сцене: все хиты, половина костей хитов, ячейки, ресурсы, истощение −1" @click="emit('restParty', 'long')">
          <GameIcon class="inline-icon" name="moon" :size="16" /> Долгий отдых отряда
        </button>
        <button type="button" :disabled="busy" title="Урон, попадания, повергнутые и опыт последнего боя на этой сцене" @click="emit('summary')">
          Итоги последнего боя
        </button>
        <button type="button" :disabled="busy" title="Привал: отдых, который длится; бой его срывает. Польза — по «Завершить» на полосе привала" @click="emit('beginRest', 'long')">
          <GameIcon class="inline-icon" name="campfire" :size="16" /> Привал (долгий)
        </button>
      </template>
    </div>
    <div v-if="canManage" class="combat-controls xp-award">
      <label>
        Опыт отряду
        <input v-model.number="partyXp" type="number" min="1" max="1000000" :disabled="busy" />
      </label>
      <button type="button" :disabled="busy || !(partyXp > 0)" title="Поровну между персонажами игроков на сцене; новый уровень — сам" @click="emit('awardParty', Math.round(partyXp))">
        <GameIcon class="inline-icon" name="starFilled" :size="16" /> Выдать поровну
      </button>
    </div>
  </div>
</template>

<style scoped>
.combat-panel details{margin-bottom:14px}
.combat-panel .eyebrow{margin-top:18px}
.roll-feed{list-style:none;padding:0;margin:0 0 14px;max-height:220px;overflow-y:auto}
.roll-feed li{padding:6px 0;border-bottom:1px solid var(--brass-light);font-size:14px}
.roll-feed .muted{color:var(--muted-ink,#665139)}
.apply-buttons{display:inline-flex;gap:4px;margin-left:8px}
.apply-buttons button{min-height:24px;padding:2px 8px;font-size:12px}
.tag{margin-left:6px;padding:1px 6px;border:1px solid var(--brass);border-radius:3px;font-size:11px}
.initiative-list{list-style:none;padding:0;margin:10px 0}
.initiative-list li{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--brass-light)}
.initiative-list li.is-current{background:#f0dfae}
.initiative-list .score{font-weight:700;min-width:28px;text-align:right}
.initiative-list .name{flex:1}
.combat-controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.economy{display:inline-flex;gap:2px}
.economy .pip{min-height:22px;width:22px;padding:0;border-radius:50%;font-size:11px}
.economy .pip.spent{opacity:.35}
.entry-actions{display:inline-flex;gap:4px}
.entry-actions button{min-height:24px;padding:2px 8px;font-size:12px}
.xp-award{align-items:end}
.xp-award label{margin:0;width:120px}
.outcome.good{color:#2f6d33}
.outcome.bad{color:#8e2a2f}
.reasons{display:block;font-size:11px;margin:2px 0 0}
.roll-feed strong.crit,.roll-feed strong.fumble{padding:0 5px;border:1px solid currentColor;border-radius:3px;white-space:nowrap}
.roll-feed strong.crit{color:#3f8a2e;background:#7ee08a22}
.roll-feed strong.fumble{color:var(--burgundy);background:#c4433a1a}
</style>
