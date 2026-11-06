<script setup lang="ts">
import { hostRunning } from '../../connection/hostStore';
import type { HostArchive } from '../../connection/hostBackups';

defineProps<{
  archive: HostArchive;
}>();
</script>

<template>
  <p class="muted">
    Полный снимок всех кампаний, персонажей, сцен и загруженных файлов этого сервера.
    Сделайте копию перед крупными изменениями.
  </p>

  <button type="button" :disabled="archive.backupBusy || !hostRunning" @click="archive.createBackupNow">
    Создать резервную копию
  </button>

  <div class="backup-schedule">
    <label>
      Автоматически
      <select v-model.number="archive.schedule.hours" :disabled="archive.backupBusy">
        <option v-for="(label, hours) in archive.SCHEDULE_TEXT" :key="hours" :value="Number(hours)">{{ label }}</option>
      </select>
    </label>
    <label>
      Хранить последних
      <input v-model.number="archive.schedule.keep" type="number" min="1" max="50" :disabled="archive.backupBusy" />
    </label>
    <button type="button" :disabled="archive.backupBusy" @click="archive.saveSchedule">Сохранить расписание</button>
    <small class="muted">Копия по расписанию делается, пока сервер этого компьютера работает; ручные копии не удаляются.</small>
  </div>

  <p v-if="archive.backupError" class="notice error">{{ archive.backupError }}</p>
  <p v-if="archive.restoreNotice" class="notice">{{ archive.restoreNotice }}</p>

  <ul v-if="archive.backups.length" class="backup-list">
    <li v-for="file in archive.shownBackups" :key="file.name" :data-kind="file.kind ?? 'manual'" :data-broken="file.complete === false">
      <span>
        <strong>{{ new Date(file.createdAt).toLocaleString('ru-RU') }}</strong>
        <small v-if="file.complete === false" class="broken-note">неполная: нет данных базы — восстановить нельзя</small>
        <small v-else>{{ archive.formatBackupSize(file.sizeBytes) }} · {{ archive.BACKUP_KIND_LABELS[file.kind ?? 'manual'] }}</small>
      </span>
      <button
        v-if="file.complete === false" type="button" class="quiet-danger" :disabled="archive.backupBusy"
        title="В папке нет данных базы — восстановить из неё нельзя. Удаляются только такие неполные копии."
        @click="archive.deleteBroken(file)"
      >Удалить</button>
      <button v-else type="button" :disabled="archive.backupBusy" @click="archive.restoreFrom(file)">Восстановить</button>
    </li>
  </ul>
  <p v-else class="muted">Резервных копий пока нет.</p>
  <button v-if="archive.backups.length > archive.BACKUPS_SHOWN" type="button" class="link-button more-backups" @click="archive.allBackups = !archive.allBackups">
    {{ archive.allBackups ? 'Только последние' : `Показать все (${archive.backups.length})` }}
  </button>
</template>

<style scoped>
.quiet-danger{color:#a83a3a}
.backup-schedule{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:10px 0}
.backup-schedule input[type="number"]{width:80px}
.backup-schedule small{flex-basis:100%}
.backup-list{list-style:none;display:flex;flex-direction:column;gap:6px;margin:10px 0 0;padding:0}
.backup-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border:1px solid var(--brass-light);border-radius:5px;background:var(--surface-inset);box-shadow:inset 3px 0 var(--g-gold-lo)}
.backup-list li[data-kind="auto"]{box-shadow:inset 3px 0 var(--g-good)}
.backup-list li[data-kind="before-restore"]{box-shadow:inset 3px 0 var(--g-warn)}
.backup-list li[data-broken="true"]{box-shadow:inset 3px 0 var(--g-bad);opacity:.8}
.broken-note{color:var(--g-bad)}
.more-backups{margin-top:8px}
.backup-list li>span{display:flex;flex-direction:column;gap:1px}
.backup-list button{flex-shrink:0;min-height:32px;padding:4px 12px}
.link-button{min-height:auto;padding:0;border:0;background:none;box-shadow:none;color:inherit;text-decoration:underline;font-weight:600}
.host-panel .backup-schedule{padding:14px;background:var(--surface-inset);border:1px solid var(--brass-light);border-radius:6px;gap:12px}
.host-panel .backup-schedule label{margin:0;flex:1;min-width:120px;font-size:12px}
.host-panel .backup-schedule input[type=number]{width:100%;box-sizing:border-box}
.host-panel .backup-list li{padding:12px;flex-wrap:wrap}
.host-panel button:focus-visible{outline:2px solid var(--brass);outline-offset:3px}
</style>
