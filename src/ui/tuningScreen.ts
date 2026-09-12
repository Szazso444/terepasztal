import { el, btn } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import { rules, setRules, resetRules, RULE_META, DEFAULT_RULES, type Rules } from '../sim/rules';

/** Live game-rule tuning: sliders for every multiplier and world parameter. */
export class TuningScreen implements Screen {
  readonly id = 'tuning';
  readonly title = STR.tuning.title;
  readonly root = el('div', { class: 'cols', style: 'flex-direction:column' });
  private body = el('div', { class: 'col-body tuning-grid' });
  private foot = el('div', { class: 'col-foot' });

  constructor(private readonly onChange: () => void) {
    this.root.append(el('div', { class: 'col' }, this.body, this.foot));
  }
  onOpen() {
    this.render();
  }

  private render() {
    const b = this.body;
    b.innerHTML = '';
    const groups = new Map<string, HTMLElement>();
    for (const m of RULE_META) {
      let g = groups.get(m.group);
      if (!g) {
        g = el('div', { class: 'tuning-group' }, el('div', { class: 'col-title', text: m.group }));
        groups.set(m.group, g);
        b.append(g);
      }
      const value = rules[m.key] as number;
      const range = el('input', {
        type: 'range',
        min: String(m.min),
        max: String(m.max),
        step: String(m.step),
        value: String(value),
      }) as HTMLInputElement;
      const num = el('input', {
        class: 'text',
        type: 'number',
        min: String(m.min),
        max: String(m.max),
        step: String(m.step),
        value: String(value),
        style: 'width:80px',
      }) as HTMLInputElement;
      const apply = (v: number) => {
        setRules({ [m.key]: v } as Partial<Rules>);
        const nv = rules[m.key] as number;
        range.value = String(nv);
        num.value = String(nv);
        row.classList.toggle('changed', nv !== (DEFAULT_RULES[m.key] as number));
        this.onChange();
      };
      range.addEventListener('input', () => apply(Number(range.value)));
      num.addEventListener('change', () => apply(Number(num.value)));
      const row = el(
        'div',
        { class: `tuning-row ${value !== (DEFAULT_RULES[m.key] as number) ? 'changed' : ''}` },
        el(
          'div',
          { class: 'tuning-label' },
          el('span', { text: m.label }),
          m.newGame ? el('span', { class: 'tag', text: STR.tuning.newGameOnly }) : null,
          m.hint ? el('div', { class: 'sub dim', text: m.hint }) : null,
        ),
        range,
        num,
      );
      g.append(row);
    }
    const f = this.foot;
    f.innerHTML = '';
    f.append(
      el('span', { class: 'dim', text: STR.tuning.note }),
      el('span', { style: 'flex:1' }),
      btn(STR.tuning.reset, () => {
        resetRules();
        this.render();
        this.onChange();
      }),
    );
  }
}
