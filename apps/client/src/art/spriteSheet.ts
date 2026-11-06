export const MAX_SHEET_CELLS = 200;

export function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Это не картинка или формат не поддерживается (нужен PNG, JPEG, WebP или GIF).')); };
    image.src = url;
  });
}

export function guessCell(width: number, height: number): { width: number; height: number } {
  if (width > height && width % height === 0) return { width: height, height };
  if (height > width && height % width === 0) return { width, height: width };
  for (const size of [256, 192, 128, 96, 64, 48, 32, 24, 16]) {
    if (size < Math.max(width, height) && width % size === 0 && height % size === 0) return { width: size, height: size };
  }
  return { width, height };
}

export function cellCount(width: number, height: number, cellWidth: number, cellHeight: number) {
  if (cellWidth < 1 || cellHeight < 1) return { columns: 0, rows: 0 };
  return { columns: Math.floor(width / cellWidth), rows: Math.floor(height / cellHeight) };
}

export function sliceSheet(image: HTMLImageElement, cellWidth: number, cellHeight: number, skipEmpty: boolean) {
  const { columns, rows } = cellCount(image.naturalWidth, image.naturalHeight, cellWidth, cellHeight);
  const cells: HTMLCanvasElement[] = [];
  let empty = 0;
  let total = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      total++;
      if (cells.length >= MAX_SHEET_CELLS) continue;
      const canvas = document.createElement('canvas');
      canvas.width = cellWidth;
      canvas.height = cellHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) continue;
      context.drawImage(image, column * cellWidth, row * cellHeight, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
      if (skipEmpty && isEmpty(context, cellWidth, cellHeight)) {
        empty++;
        continue;
      }
      cells.push(canvas);
    }
  }
  return { cells, total, empty, cut: total > MAX_SHEET_CELLS + empty };
}

function isEmpty(context: CanvasRenderingContext2D, width: number, height: number) {
  const data = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < data.length; index += 4) if (data[index]! > 8) return false;
  return true;
}

export function fitSquare(source: HTMLCanvasElement | HTMLImageElement, size: number): HTMLCanvasElement {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const scale = Math.min(size / width, size / height);
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));
  context.imageSmoothingEnabled = scale < 1;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
  return canvas;
}

export function canvasDataUrl(canvas: HTMLCanvasElement): string {
  const webp = canvas.toDataURL('image/webp', 0.92);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob && blob.type === 'image/webp') return resolve(blob);
      canvas.toBlob(png => (png ? resolve(png) : reject(new Error('Не удалось сохранить картинку. Попробуйте ещё раз.'))), 'image/png');
    }, 'image/webp', 0.92);
  });
}
