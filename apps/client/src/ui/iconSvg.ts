import { GAME_ICONS, type GameIconName } from './gameIcons';

const SVG = 'http://www.w3.org/2000/svg';

export function iconSvg(name: GameIconName, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  const attributes: Record<string, string> = {
    width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'label-icon',
  };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
  for (const d of GAME_ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d.replace(/^\*/, ''));
    if (d.startsWith('*')) path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
  }
  return svg;
}
