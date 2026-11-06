import { computed, reactive, ref } from 'vue';

import { confirmAction } from '../ui/confirmDialog';
import type { Signal } from './hostSignals';

export function useHostBackups() {
  const backups = ref<BackupFile[]>([]);
  const backupBusy = ref(false);
  const backupError = ref('');

  async function refreshBackups() {
    if (!window.desktop) return;
    backups.value = await window.desktop.host.listBackups();
  }

  async function createBackupNow() {
    if (!window.desktop) return;
    backupBusy.value = true;
    backupError.value = '';

    try {
      backups.value = await window.desktop.host.backup();
    } catch (cause) {
      backupError.value = cause instanceof Error ? cause.message : 'Не удалось создать резервную копию. Попробуйте ещё раз.';
    } finally {
      backupBusy.value = false;
    }
  }

  const restoreNotice = ref('');
  const schedule = ref<{ hours: number; keep: number }>({ hours: 24, keep: 7 });
  const BACKUP_KIND_LABELS = { manual: 'вручную', auto: 'по расписанию', 'before-restore': 'перед восстановлением' } as const;
  const SCHEDULE_TEXT: Record<number, string> = { 0: 'выключено', 6: 'каждые 6 ч.', 12: 'каждые 12 ч.', 24: 'раз в сутки', 72: 'раз в 3 дня', 168: 'раз в неделю' };

  const WEEK = 7 * 24 * 3600 * 1000;
  const backupSignal = computed<Signal>(() => {
    const latest = backups.value.find(file => file.complete !== false) ?? null;
    const broken = backups.value.filter(file => file.complete === false).length;
    const plan = schedule.value.hours ? `по расписанию — ${SCHEDULE_TEXT[schedule.value.hours] ?? `раз в ${schedule.value.hours} ч.`}` : 'расписание выключено';
    const brokenText = broken ? ` · неполных: ${broken}` : '';
    if (!latest) return { status: broken ? 'целых копий нет' : 'копий нет', tone: broken ? 'bad' : 'warn', summary: `Страховка перед крупными изменениями · ${plan}${brokenText}` };
    const old = Date.now() - new Date(latest.createdAt).getTime() > WEEK;
    return {
      status: `${old ? 'давно' : 'последняя'}: ${new Date(latest.createdAt).toLocaleDateString('ru-RU')}`,
      tone: old || broken ? 'warn' : schedule.value.hours ? 'ok' : 'info',
      summary: `Копий: ${backups.value.length - broken} · ${plan}${brokenText}`,
    };
  });
  const BACKUPS_SHOWN = 5;
  const allBackups = ref(false);
  const shownBackups = computed(() => (allBackups.value ? backups.value : backups.value.slice(0, BACKUPS_SHOWN)));

  async function loadSchedule() {
    if (!window.desktop?.host.getBackupSchedule) return;
    try {
      schedule.value = await window.desktop.host.getBackupSchedule();
    } catch {
    }
  }

  async function saveSchedule() {
    if (!window.desktop) return;
    backupError.value = '';
    try {
      const keep = Math.min(50, Math.max(1, Math.round(Number(schedule.value.keep) || 7)));
      schedule.value.keep = keep;
      schedule.value = await window.desktop.host.setBackupSchedule({ hours: Number(schedule.value.hours), keep });
      restoreNotice.value = schedule.value.hours ? `Копии будут делаться раз в ${schedule.value.hours} ч., пока сервер работает; хранятся последние ${schedule.value.keep}.` : 'Копии по расписанию выключены.';
    } catch (cause) {
      backupError.value = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function restoreFrom(file: BackupFile) {
    if (!window.desktop) return;
    const when = new Date(file.createdAt).toLocaleString('ru-RU');
    if (!(await confirmAction(
      `Восстановить все кампании этого сервера из копии от ${when}?\n\n` +
      'Всё, что изменилось после неё, пропадёт. Перед восстановлением будет сделана копия текущего состояния — к нему можно вернуться так же. ' +
      'Сервер на минуту остановится; игрокам придётся переподключиться, а вам, возможно, войти заново.',
      { title: 'Восстановить из копии', confirmLabel: 'Восстановить', danger: true },
    ))) return;

    backupBusy.value = true;
    backupError.value = '';
    restoreNotice.value = '';
    try {
      backups.value = await window.desktop.host.restore(file.name);
      restoreNotice.value = `Восстановлено из копии от ${when}. Если стол показывает старое — обновите списки или войдите заново.`;
    } catch (cause) {
      backupError.value = cause instanceof Error ? cause.message : 'Не удалось восстановить. Попробуйте ещё раз.';
      await refreshBackups();
    } finally {
      backupBusy.value = false;
    }
  }

  async function deleteBroken(file: BackupFile) {
    if (!window.desktop?.host.deleteBrokenBackup) return;
    backupBusy.value = true;
    backupError.value = '';
    try {
      backups.value = await window.desktop.host.deleteBrokenBackup(file.name);
    } catch (cause) {
      backupError.value = cause instanceof Error ? cause.message : 'Не удалось удалить неполную копию. Попробуйте ещё раз.';
    } finally {
      backupBusy.value = false;
    }
  }

  function formatBackupSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }

  // Mutable on purpose: the backups view writes schedule and allBackups.
  return reactive({
    backups, backupBusy, backupError, refreshBackups, createBackupNow, restoreNotice, schedule, BACKUP_KIND_LABELS, SCHEDULE_TEXT,
    backupSignal, BACKUPS_SHOWN, allBackups, shownBackups, loadSchedule, saveSchedule, restoreFrom, deleteBroken, formatBackupSize,
  });
}

export type HostArchive = ReturnType<typeof useHostBackups>;
