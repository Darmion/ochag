export type LabelBlock = {
  id: string;
  x: number;
  y: number;
  width: number;
  above: number;
  below: number;
  priority: number;
};

export type LabelShift = { dx: number; dy: number; lift: number };

type Box = { left: number; top: number; right: number; bottom: number };

const overlaps = (a: Box, b: Box, gap: number) =>
  a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;

export function layoutLabels(
  blocks: LabelBlock[],
  size: { width: number; height: number },
  options: { maxShift?: number; gap?: number; edge?: number; previous?: Map<string, LabelShift> } = {},
): Map<string, LabelShift> {
  const maxShift = options.maxShift ?? 40;
  const gap = options.gap ?? 6;
  const edge = options.edge ?? 4;
  const previous = options.previous;
  const result = new Map<string, LabelShift>();
  const stayed = (block: LabelBlock) => ((previous?.get(block.id)?.lift ?? 0) === 0 ? 0 : 1);
  const ordered = [...blocks].sort((a, b) => b.priority - a.priority || stayed(a) - stayed(b) || b.y - a.y || a.id.localeCompare(b.id));
  const resolve = ordered.length <= 80;
  const placed: Box[] = [];

  for (const block of ordered) {
    let left = block.x - block.width / 2;
    let top = block.y - block.above;
    const height = block.above + block.below;
    let dx = 0, dy = 0;
    if (block.width < size.width - 2 * edge) {
      if (left < edge) dx = edge - left;
      else if (left + block.width > size.width - edge) dx = size.width - edge - (left + block.width);
    }
    const fitsHeight = height < size.height - 2 * edge;
    if (fitsHeight) {
      if (top < edge) dy = edge - top;
      else if (top + height > size.height - edge) dy = size.height - edge - (top + height);
    }
    left += dx;
    top += dy;
    const box = (shift: number): Box => ({ left, top: top + shift, right: left + block.width, bottom: top + shift + height });
    const freeAt = (shift: number) =>
      (!fitsHeight || (top + shift >= edge && top + shift + height <= size.height - edge)) &&
      !placed.some(other => overlaps(box(shift), other, gap));

    let lift = 0;
    if (resolve && !freeAt(0)) {
      const before = previous?.get(block.id)?.lift ?? 0;
      if (before !== 0 && Math.abs(before) <= maxShift && freeAt(before)) {
        lift = before;
      } else {
        const candidates: number[] = [];
        for (const other of placed) {
          candidates.push(other.top - gap - (top + height));
          candidates.push(other.bottom + gap - top);
        }
        candidates.sort((a, b) => Math.abs(a) - Math.abs(b));
        lift = candidates.find(shift => Math.abs(shift) <= maxShift && freeAt(shift)) ?? 0;
      }
    }
    placed.push(box(lift));
    result.set(block.id, { dx: Math.round(dx), dy: Math.round(dy + lift), lift: Math.round(lift) });
  }
  return result;
}
