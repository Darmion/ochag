import { ref, watch, nextTick, onBeforeUnmount, type Ref } from 'vue';

export type CellLayoutDeps = {
  catRow: Ref<HTMLElement | null>;
};

export function useCellLayout({ catRow }: CellLayoutDeps) {
  const compactCats = ref(false);
  let fullCat = { width: 76, height: 76 };
  function measureCats() {
    const row = catRow.value;
    if (!row) return;
    const cells = row.querySelectorAll('.cat');
    if (!cells.length) return;
    if (!compactCats.value) {
      const first = cells[0] as HTMLElement;
      if (first.offsetWidth > 0) fullCat = { width: first.offsetWidth, height: first.offsetHeight };
    }
    const style = getComputedStyle(row);
    const gapX = parseFloat(style.columnGap) || 8;
    const gapY = parseFloat(style.rowGap) || 6;
    const limit = parseFloat(style.maxHeight) || row.clientHeight;
    const perRow = Math.max(1, Math.floor((row.clientWidth + gapX) / (fullCat.width + gapX)));
    const rows = Math.ceil(cells.length / perRow);
    compactCats.value = rows * (fullCat.height + gapY) - gapY > limit + 2;
  }
  let catObserver: ResizeObserver | null = null;
  watch(catRow, element => {
    catObserver?.disconnect();
    catObserver = null;
    if (element && typeof ResizeObserver !== 'undefined') {
      catObserver = new ResizeObserver(() => measureCats());
      catObserver.observe(element);
    }
    void nextTick(measureCats);
  });
  onBeforeUnmount(() => catObserver?.disconnect());

  return { compactCats, measureCats };
}
