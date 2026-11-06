import { reactive } from 'vue';

export type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmRequest = Required<ConfirmOptions> & { message: string; resolve: (ok: boolean) => void };

export const confirmState = reactive<{ current: ConfirmRequest | null; queue: ConfirmRequest[] }>({ current: null, queue: [] });

export function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise(resolve => {
    const request: ConfirmRequest = {
      message,
      title: options.title ?? 'Подтвердите',
      confirmLabel: options.confirmLabel ?? 'Подтвердить',
      cancelLabel: options.cancelLabel ?? 'Отмена',
      danger: options.danger ?? false,
      resolve,
    };
    if (confirmState.current) confirmState.queue.push(request);
    else confirmState.current = request;
  });
}

export function settleConfirm(ok: boolean) {
  const request = confirmState.current;
  if (!request) return;
  confirmState.current = confirmState.queue.shift() ?? null;
  request.resolve(ok);
}
