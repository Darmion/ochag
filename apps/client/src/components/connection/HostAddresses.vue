<script setup lang="ts">
import {
  firewallVerdict,
  hostLanMode,
  hostLocalUrl,
  hostStatus,
  internetAddresses,
  playerAddresses,
} from '../../connection/hostStore';

const KIND_TEXT: Record<HostAddress['kind'], { tag: string; usage: string }> = {
  vpn: { tag: 'Виртуальная сеть', usage: 'для игроков в вашей виртуальной локальной сети (через интернет).' },
  lan: { tag: 'Домашняя сеть', usage: 'для игроков, подключённых к тому же роутеру (Wi-Fi или кабель).' },
  other: { tag: 'Служебный', usage: 'виртуальная машина, WSL или туннель прокси-клиента — игроки через него не подключатся.' },
};

defineProps<{
  copied: string;
  serviceAddresses: HostAddress[];
  hasVpn: boolean;
}>();
defineEmits<{
  copy: [text: string];
}>();
</script>

<template>
  <p class="muted section-note">Копируйте адрес только для подходящего способа подключения.</p>

  <ul v-if="internetAddresses.length" class="address-list">
    <li v-for="address in internetAddresses" :key="address.url">
      <div>
        <strong class="address">{{ address.url }}</strong>
        <span class="tag" data-kind="internet">Интернет</span>
        <small>{{ address.label }} — для игроков из интернета, без VPN.</small>
      </div>
      <button type="button" @click="$emit('copy', address.url)">
        {{ copied === address.url ? 'Скопировано' : 'Копировать' }}
      </button>
    </li>
  </ul>

  <p v-if="!hostLanMode && !internetAddresses.length" class="notice warning">
    Сейчас сервер принимает подключения только с этого компьютера —
    игроки не смогут войти. Включите «Подключения игроков по сети» в «Основных настройках».
  </p>

  <template v-else>
    <p class="muted">
      Все игроки подключаются к одному и тому же порту <strong>{{ hostStatus.port }}</strong>.
      Отличается только IP-адрес — выберите его по тому, как игрок связан с вами.
      Проще всего: создайте приглашение на вкладке «Кампании» — адрес попадёт в него сам.
    </p>

    <div v-if="hostStatus.tls" class="certificate-info">
      <div>
        Код сертификата сервера: <strong class="certificate-code">{{ hostStatus.tls.code }}</strong>
        <small>
          Подключение зашифровано. При первом входе игрок увидит этот же код и сверит его с вами
          (в приглашении он уже есть — тогда сверка пройдёт сама).
        </small>
      </div>
      <button type="button" @click="$emit('copy', hostStatus.tls.code)">
        {{ copied === hostStatus.tls.code ? 'Скопировано' : 'Копировать' }}
      </button>
    </div>
    <p v-else class="notice warning">
      Подключения не шифруются: пароли и ход игры видны любому в той же сети.
      Включите «Защищённые подключения TLS» в «Основных настройках».
    </p>

    <ul v-if="playerAddresses.length" class="address-list">
      <li v-for="(address, index) in playerAddresses" :key="address.url" :data-firewall="firewallVerdict(address).state">
        <div>
          <strong class="address">{{ address.url }}</strong>
          <span class="tag" :data-kind="address.kind">{{ KIND_TEXT[address.kind].tag }}</span>
          <span v-if="index === 0 && playerAddresses.length > 1" class="tag" data-kind="best">рекомендуется</span>
          <small>Адаптер «{{ address.interfaceName }}» — {{ KIND_TEXT[address.kind].usage }}</small>
          <small class="verdict" :data-state="firewallVerdict(address).state">
            Брандмауэр:
            {{
              firewallVerdict(address).state === 'ok'
                ? '✔ пропускает'
                : firewallVerdict(address).state === 'blocked'
                  ? '✖ блокирует'
                  : '? неизвестно'
            }}
            — {{ firewallVerdict(address).reason }}
          </small>
        </div>
        <button type="button" @click="$emit('copy', address.url)">
          {{ copied === address.url ? 'Скопировано' : 'Копировать' }}
        </button>
      </li>
    </ul>

    <p v-else class="notice warning">
      У компьютера нет подходящего сетевого адреса: он не подключён ни к домашней, ни к виртуальной локальной сети.
    </p>

    <p v-if="!hasVpn" class="muted">
      Виртуальная локальная сеть не найдена. Если игроки не в вашей домашней сети,
      подключите компьютер к общей с ними виртуальной сети — её адрес появится здесь.
    </p>

    <details v-if="serviceAddresses.length" class="service-addresses">
      <summary>Служебные адаптеры ({{ serviceAddresses.length }}) — игрокам не подходят</summary>
      <ul>
        <li v-for="address in serviceAddresses" :key="address.url">
          <code>{{ address.url }}</code> — «{{ address.interfaceName }}»: {{ KIND_TEXT.other.usage }}
        </li>
      </ul>
    </details>

    <p class="muted local-address">
      Вы сами на этом компьютере подключены по адресу <code>{{ hostLocalUrl }}</code> —
      он работает только здесь, игрокам его не давайте.
    </p>
  </template>
</template>

<style scoped>
.section-note{margin:8px 0 2px}
.address-list{list-style:none;padding:0;margin:10px 0;display:flex;flex-direction:column;gap:8px}
.address-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--brass-light);border-radius:5px;background:var(--surface-inset)}
.address-list li[data-firewall="ok"]{box-shadow:inset 3px 0 var(--g-good)}
.address-list li[data-firewall="blocked"]{box-shadow:inset 3px 0 var(--g-bad)}
.address-list li>div{display:flex;flex-wrap:wrap;align-items:center;gap:2px 0}
.address-list li>div>small{flex-basis:100%}
.address-list .address{font-family:Consolas,monospace;font-size:16px;margin-right:8px}
.address-list button{flex-shrink:0;min-height:36px;padding:6px 12px}
.verdict{font-weight:600}
.verdict[data-state="ok"]{color:var(--g-good)}
.verdict[data-state="blocked"]{color:var(--g-bad)}
.tag{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:10px;border:1px solid var(--brass-light);margin-right:4px;vertical-align:middle}
.tag[data-kind="vpn"]{background:#315246;color:#f1e4c5;border-color:#315246}
.tag[data-kind="internet"]{background:#2d4a6b;color:#f1e4c5;border-color:#2d4a6b}
.tag[data-kind="best"]{color:var(--g-gold-hi);border-color:var(--g-gold-lo)}
.service-addresses summary{font-size:15px}
.certificate-info{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:10px 0;padding:10px 12px;border:1px solid var(--brass-light);border-radius:6px}
.certificate-info small{display:block}
.certificate-code{font-family:ui-monospace,Consolas,monospace;font-size:1.15em;letter-spacing:.06em}
.service-addresses ul{font-size:13px;line-height:1.6;margin:0}
.local-address{margin-bottom:0}
code{font-family:Consolas,monospace}
@media (max-width:720px){.address-list li{align-items:stretch;flex-direction:column}.address-list button{align-self:flex-start}}
.host-panel .address-list li{align-items:stretch;flex-direction:column;padding:14px;border-radius:6px;gap:10px}
.host-panel .address-list li>div{min-width:0;gap:6px}
.host-panel .address-list .address{width:100%;overflow-wrap:anywhere;font-size:14px;margin:0}
.host-panel .address-list button{align-self:flex-start}
.host-panel .certificate-info{align-items:flex-start;flex-wrap:wrap;padding:14px}
.host-panel .certificate-code{overflow-wrap:anywhere}
.host-panel code{overflow-wrap:anywhere}
.host-panel button:focus-visible{outline:2px solid var(--brass);outline-offset:3px}
</style>
