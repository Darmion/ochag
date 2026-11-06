<script setup lang="ts">
import {
  allowFirewall,
  firewall,
  firewallBusy,
  firewallMessage,
  firewallSummary,
  hostStatus,
  NETWORK_CATEGORY_LABELS,
  refreshFirewall,
} from '../../connection/hostStore';

defineProps<{
  firewallCheckedAt: string | null;
}>();
</script>

<template>
  <p v-if="firewallSummary === 'ok'" class="notice success">
    ✔ Брандмауэр пропускает подключения игроков по всем адресам выше.
  </p>
  <p v-else-if="firewallSummary === 'blocked'" class="notice error">
    ✖ Брандмауэр Windows будет отбрасывать подключения игроков по адресам, помеченным «✖ блокирует».
    Чаще всего это виртуальная локальная сеть: Windows относит её к «общедоступным» сетям, а при первом запуске
    доступ дали только «частным». Нажмите «Разрешить в брандмауэре».
  </p>
  <p v-else class="muted">
    {{ firewall ? 'Не удалось проверить все правила брандмауэра. Попробуйте ещё раз.' : 'Проверяю…' }}
    Если игроки не могут подключиться — нажмите «Разрешить в брандмауэре».
  </p>

  <div class="firewall-actions">
    <button
      type="button"
      :class="{ primary: firewallSummary !== 'ok' }"
      :disabled="firewallBusy"
      @click="allowFirewall"
    >
      Разрешить в брандмауэре
    </button>
    <button type="button" :disabled="firewallBusy" @click="refreshFirewall">
      Проверить снова
    </button>
  </div>
  <small class="firewall-hint">
    Кнопка открывает порт {{ hostStatus.port }} для всех типов сетей и убирает правила «Блокировать» для этого приложения.
    Потребуются права администратора: Windows спросит подтверждение.
  </small>
  <p v-if="firewallMessage" class="muted">{{ firewallMessage }}</p>

  <details
    v-if="firewall && firewall.supported && firewall.known"
    class="firewall-details"
  >
    <summary>Подробнее о проверке</summary>
    <p class="muted">
      Проверено в {{ firewallCheckedAt }}, перепроверяется каждые 30 секунд.
      Программа: <code>{{ firewall.programPath }}</code>, порт сервера {{ firewall.port }}.
      Для игроков важны только правила для TCP (или любого протокола) на этот порт.
    </p>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr><th>Правило</th><th>Действие</th><th>Сети</th><th>Протокол</th><th>Порт</th></tr>
        </thead>
        <tbody>
          <tr v-for="(rule, index) in [...firewall.portRules, ...firewall.appRules]" :key="index">
            <td>{{ rule.name }}</td>
            <td>{{ rule.action === 'Allow' ? 'Разрешить' : rule.action === 'Block' ? 'Блокировать' : rule.action }}</td>
            <td>{{ rule.profile }}</td>
            <td>{{ rule.protocol }}</td>
            <td>{{ rule.port }}</td>
          </tr>
          <tr v-if="!firewall.portRules.length && !firewall.appRules.length">
            <td colspan="5">Правил для приложения не найдено.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="muted">
      Типы сетей:
      <template v-for="(category, alias, index) in firewall.networks" :key="alias">
        {{ index ? ', ' : '' }}«{{ alias }}» — {{ NETWORK_CATEGORY_LABELS[category] ?? category }}
      </template>
    </p>
  </details>
</template>

<style scoped>
.firewall-actions{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 4px}
.firewall-hint{display:block;color:var(--muted-ink)}
.firewall-details summary{font-size:15px}
.firewall-details table{font-size:13px}
.firewall-details th,.firewall-details td{padding:6px 8px}
code{font-family:Consolas,monospace}
.host-panel code{overflow-wrap:anywhere}
.host-panel button:focus-visible{outline:2px solid var(--brass);outline-offset:3px}
</style>
