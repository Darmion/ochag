function scrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

export function lockNearestScroll(el: HTMLElement | null): () => void {
  const target = scrollableAncestor(el);
  if (!target) return () => {};
  const previous = target.style.overflowY;
  target.style.overflowY = 'hidden';
  let done = false;
  return () => {
    if (done) return;
    done = true;
    target.style.overflowY = previous;
  };
}
