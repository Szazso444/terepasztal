import { el } from './dom';

export class Tooltip {
  readonly root = el('div', { id: 'tooltip', class: 'panel' });
  show(x: number, y: number, title: string, lines: string[] = []) {
    this.root.innerHTML = '';
    this.root.append(el('div', { class: 'tt-title', text: title }));
    for (const l of lines) this.root.append(el('div', { text: l }));
    this.root.classList.add('show');
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const px = Math.min(window.innerWidth - w - 8, x + 14);
    const py = Math.min(window.innerHeight - h - 8, y + 14);
    this.root.style.left = `${px}px`;
    this.root.style.top = `${py}px`;
  }
  hide() {
    this.root.classList.remove('show');
  }
}
