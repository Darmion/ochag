import { onBeforeUnmount, onMounted } from 'vue';

const stack: Array<() => void> = [];
let installed = false;

function typingIn(element: Element | null) {
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (element as HTMLElement).isContentEditable;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !stack.length) return;
  window.setTimeout(() => {
    if (event.defaultPrevented) return;
    const focused = document.activeElement;
    if (typingIn(focused)) {
      (focused as HTMLElement).blur();
      return;
    }
    stack[stack.length - 1]?.();
  }, 0);
}

export const escapeOpen = () => stack.length > 0;

export function useEscapeClose(close: () => void) {
  onMounted(() => {
    stack.push(close);
    if (!installed) {
      window.addEventListener('keydown', onKeydown);
      installed = true;
    }
  });
  onBeforeUnmount(() => {
    const index = stack.lastIndexOf(close);
    if (index >= 0) stack.splice(index, 1);
  });
}
