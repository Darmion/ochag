<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { computed, ref } from 'vue';
import GameIcon from '../game/GameIcon.vue';

export type HelpTab = 'how' | 'player' | 'host' | 'trouble' | 'credits';

const props = defineProps<{ initialTab?: HelpTab }>();
const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

const tab = ref<HelpTab>(props.initialTab ?? 'how');

const TABS: { id: HelpTab; label: string }[] = [
  { id: 'how', label: 'Как это устроено' },
  { id: 'player', label: 'Я игрок' },
  { id: 'host', label: 'Я мастер' },
  { id: 'trouble', label: 'Не подключается' },
  { id: 'credits', label: 'Авторы' },
];
const title = computed(() => (tab.value === 'credits' ? 'Авторы и благодарности' : 'Подключение'));

</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="help-title" @click.self="emit('close')">
    <div class="modal-card help-card">
      <header class="modal-header">
        <h3 id="help-title">{{ title }}</h3>
        <button type="button" class="modal-close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <nav class="help-tabs" aria-label="Разделы справки">
        <button
          v-for="item in TABS"
          :key="item.id"
          type="button"
          :aria-pressed="tab === item.id"
          @click="tab = item.id"
        >
          {{ item.label }}
        </button>
      </nav>

      <section v-if="tab === 'how'" class="help-body">
        <ol class="scheme">
          <li>
            <strong>Один компьютер — сервер.</strong>
            Обычно это компьютер мастера. На нём хранится всё: аккаунты, кампании,
            персонажи, карты и загруженные модели.
          </li>
          <li>
            <strong>Остальные только подключаются</strong> к нему по адресу вида
            <code>http://26.34.12.5:3000</code>: IP-адрес компьютера мастера и порт.
          </li>
          <li>
            <strong>Порт у всех один и тот же</strong> (по умолчанию 3000). Разные порты
            для разных игроков не нужны: сервер различает игроков по аккаунтам.
            В списке игроков у мастера видно, с какого IP и через какую сеть вошёл каждый.
          </li>
        </ol>

        <div class="callout">
          <strong>Аккаунты и кампании у каждого сервера свои.</strong>
          Логин «artur» на вашем сервере и «artur» на сервере друга — это два разных
          аккаунта с разными кампаниями. Ничего не синхронизируется само: если после
          входа нет ваших кампаний, вы вошли на другой сервер. Проверьте строку
          «Подключено к…» вверху экрана. Чтобы перенести кампанию на другой сервер,
          используйте «Перенос кампании» (экспорт в файл и импорт).
        </div>

        <h4>Как компьютеры видят друг друга</h4>
        <ul>
          <li><strong>Дома, через один роутер:</strong> адрес вида <code>192.168.x.x</code>. Больше ничего не нужно.</li>
          <li>
            <strong>Через интернет в виртуальной сети:</strong> всем подключиться к одной
            виртуальной локальной сети. Адрес мастера — с пометкой «Виртуальная сеть».
          </li>
          <li>
            <strong>Через интернет без виртуальной сети — туннель Cloudflare:</strong> мастер во вкладке «Сервер» →
            «Игроки через интернет» включает туннель и получает адрес <code>https://….trycloudflare.com</code>
            (быстрый — новый при каждом запуске) или свой постоянный адрес на домене. Роутер и белый IP не нужны.
            У части провайдеров в России Cloudflare ограничена — кнопка «Проверить, пропускает ли провайдер Cloudflare» на экране входа скажет сразу.
          </li>
          <li>
            <strong>Через интернет без виртуальной сети — белый IP мастера:</strong> если провайдер даёт мастеру белый IP,
            игроки подключаются прямо к его роутеру (приложение пробросит порт по UPnP или подскажет, как сделать это вручную).
            Приложение само проверит, не серый ли IP.
          </li>
          <li>
            Из интернета (туннель, белый IP) <strong>регистрируются по приглашению</strong>: вставьте текст
            приглашения целиком, затем «Регистрация». Мастер может разрешить регистрацию без приглашения.
          </li>
          <li><strong><code>127.0.0.1</code></strong> означает «этот же компьютер». Игрокам такой адрес не давайте.</li>
        </ul>
      </section>

      <section v-else-if="tab === 'player'" class="help-body">
        <ol class="steps">
          <li>
            <strong>Если мастер не у вас дома</strong>, подключитесь к его виртуальной
            локальной сети: имя и пароль сети даёт мастер. Компьютер мастера должен быть
            виден в этой сети.
          </li>
          <li>Шаг 1 «Кто вы»: нажмите <strong>«Я игрок»</strong>.</li>
          <li>
            Шаг 2 «Подключение к мастеру»: скопируйте приглашение, которое прислал мастер, целиком и
            нажмите <strong>«Вставить из буфера обмена»</strong> (или Ctrl+V в поле). Приложение само найдёт
            сервер и покажет «✔ Сервер мастера найден». Если попросит сверить код сертификата — спросите код
            у мастера; с приглашением сверка обычно проходит сама. Приглашения нет — «ввести адрес сервера вручную».
          </li>
          <li>
            Шаг 3 «Аккаунт»: впервые у этого мастера — <strong>«Я здесь впервые»</strong>, придумайте любой
            логин и пароль. Уже играли — «У меня уже есть аккаунт».
          </li>
          <li>После входа вы сразу в кампании из приглашения.</li>
          <li>
            Галочка <strong>«Запомнить меня на этом компьютере»</strong>: в следующий раз — экран
            «С возвращением» и вход одной кнопкой. Пароль хранится в зашифрованном виде средствами Windows.
          </li>
        </ol>
      </section>

      <section v-else-if="tab === 'host'" class="help-body">
        <ol class="steps">
          <li>
            <strong>Если игроки не у вас дома</strong>, создайте виртуальную локальную сеть
            и сообщите игрокам её имя и пароль.
          </li>
          <li>
            Шаг 1 «Кто вы»: нажмите <strong>«Я мастер»</strong>. Шаг 2 «Ваш сервер»: сервер запускается сам.
          </li>
          <li>
            Там же ответьте «Где будут ваши игроки?»: <strong>«Дома или в виртуальной сети»</strong> — приложение
            пустит их по сети; <strong>«Через интернет, без общей сети»</strong> — после входа включите туннель во вкладке
            «Сервер» → «Игроки через интернет». Тонкие настройки — «Подробные настройки сервера».
          </li>
          <li>
            Если приложение показывает предупреждение о брандмауэре, нажмите
            <strong>«Разрешить в брандмауэре»</strong> и подтвердите запрос Windows. Без этого
            подключения через виртуальную сеть обычно не проходят.
          </li>
          <li>Шаг 3 «Аккаунт»: «Я здесь впервые» — придумайте логин и пароль мастера.</li>
          <li>
            Создайте кампанию, затем <strong>«Пригласить игрока»</strong>. Выберите адрес
            (с пометкой «Виртуальная сеть» — для игроков через интернет, «Домашняя сеть» — для игроков дома), нажмите
            «Скопировать приглашение» и отправьте текст игроку. Каждому игроку нужно
            отдельное приглашение.
          </li>
          <li>
            Во вкладке <strong>«Сервер»</strong> видно, кто подключён, с какого IP и через какой
            адрес. Там же есть журнал попыток входа.
          </li>
        </ol>
        <p class="muted">
          Сервер работает, пока открыто приложение. Закрытие окна корректно останавливает
          сервер и базу. Данные при этом сохраняются.
        </p>
      </section>

      <section v-else-if="tab === 'credits'" class="help-body credits">
        <h4>Картинки</h4>
        <p>
          Значки предметов, оружия, зелий, школ магии, рамки и курсоры — набор
          <a href="https://helloiamsinan.itch.io/rpg-essentials-ultimate-fantasy-icons-gui-pack" target="_blank" rel="noreferrer">«RPG Essentials: Ultimate Fantasy Icons &amp; GUI Pack»</a>,
          автор <b>helloiamsinan</b> (itch.io). Используется с разрешения автора — спасибо!
        </p>
        <h4>Звуки</h4>
        <p>
          Удары, выстрелы, заклинания, двери, сундуки, факелы, шаги и фон мест (лес, пещера, море,
          дождь, река) — набор <a href="https://tommusic.itch.io/" target="_blank" rel="noreferrer">«Free Fantasy SFX Pack»</a>,
          автор <b>TomMusic</b> (itch.io). Спасибо!
        </p>
        <h4>Шрифты</h4>
        <ul>
          <li><b>Ruslan Display</b> — Денис Машаров; <b>Yeseva One</b> — Jovanny Lemonad; <b>Vollkorn</b> — Friedrich Althausen. Все — по лицензии SIL Open Font License 1.1.</li>
        </ul>
        <h4>Правила</h4>
        <p>
          Заклинания, монстры, классы, расы и предметы — из System Reference Document 5.1 (SRD 5.1)
          Wizards of the Coast LLC, лицензия Creative Commons Attribution 4.0 International.
          Тексты заклинаний переведены на русский для «Очага» с SRD 5.1.
        </p>
        <p class="legal" lang="en">
          This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at
          <a href="https://dnd.wizards.com/resources/systems-reference-document" target="_blank" rel="noreferrer">https://dnd.wizards.com/resources/systems-reference-document</a>.
          The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at
          <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noreferrer">https://creativecommons.org/licenses/by/4.0/legalcode</a>.
        </p>
        <h4>Сделано на</h4>
        <p>Vue, Babylon.js, Fastify, PostgreSQL, Electron — спасибо их авторам и сообществам.</p>
      </section>

      <section v-else class="help-body">
        <dl class="trouble">
          <dt>«Компьютер по этому адресу не отвечает»</dt>
          <dd>
            Подключение не доходит до компьютера мастера. Мастеру: во вкладке «Сервер» нажать
            «Разрешить в брандмауэре». Обоим: виртуальная сеть включена, оба компьютера в
            одной сети. Связь проверяет команда <code>ping</code> с адресом мастера в
            командной строке. Сверьте IP в адресе.
          </dd>

          <dt>«Сервер игры на нём не отвечает»</dt>
          <dd>
            Компьютер найден, но сервер недоступен: мастер не нажал «Запустить сервер», не
            отметил «Подключения игроков по сети», или в адресе другой порт.
          </dd>

          <dt>«На этом сервере нет аккаунта…»</dt>
          <dd>
            Вы подключены не к тому серверу, или ещё не зарегистрировались у этого мастера.
            Аккаунты других серверов здесь не действуют.
          </dd>

          <dt>Вход прошёл, но кампаний нет</dt>
          <dd>
            Посмотрите строку «Подключено к…» вверху. Если там «этот компьютер» или имя вашего
            компьютера, вы вошли на свой собственный сервер, а не к мастеру. Нажмите на эту строку,
            затем «Выйти / сменить сервер», и укажите адрес мастера.
          </dd>

          <dt>«На этом сервере нет такого приглашения»</dt>
          <dd>
            Приглашение создано на другом сервере. Подключитесь к адресу, который указан в самом
            приглашении. Приложение предложит переключиться, если вставить приглашение целиком.
          </dd>

          <dt>Мастер: как понять, доходит ли игрок до сервера?</dt>
          <dd>
            Вкладка «Сервер» → «Последние попытки входа». Если попытки игрока там есть,
            сеть в порядке и дело в логине или пароле (причина указана рядом). Если попыток нет,
            подключение не доходит до сервера: проверьте брандмауэр, VPN и адрес.
          </dd>

          <dt>Какой адрес давать игрокам?</dt>
          <dd>
            В виртуальной сети: адрес с пометкой «Виртуальная сеть». Дома через один роутер: адрес
            «Домашняя сеть» (192.168.x.x или 10.x.x.x). Адрес 127.0.0.1 работает только
            на компьютере мастера.
          </dd>
        </dl>
      </section>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3000;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-card{width:min(760px,100%);max-height:90vh;overflow-y:auto;padding:24px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.modal-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.modal-header h3{margin:0}
.modal-close{min-height:32px;width:32px;padding:0}
.help-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;padding-bottom:14px;border-bottom:3px double var(--panel-border)}
.help-tabs button{min-height:36px;padding:6px 12px;font-size:14px}
.help-body{line-height:1.6;font-size:15px}
.help-body h4{margin:18px 0 6px;font-size:17px}
.help-body li{margin-bottom:8px}
.callout{padding:12px 14px;border-left:4px solid var(--burgundy-light);background:var(--surface-inset);margin:14px 0}
.trouble dt{font-weight:700;margin-top:14px}
.credits .legal{font-size:13px;color:var(--muted-ink);overflow-wrap:anywhere}
.trouble dd{margin:4px 0 0 0;padding-left:12px;border-left:2px solid var(--brass-light)}
code{font-family:Consolas,monospace;font-size:14px}
</style>
