import { el, btn } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import {
  content,
  DEFAULT_CONTENT,
  CONTENT_KEYS,
  validateContent,
  writeContentOverrides,
  clearContentOverrides,
  contentIsCustom,
  type ContentBundle,
  type ContentKey,
} from '../data/content';

type Row = Record<string, unknown>;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * In-client content editor. Works on a copy of the live bundle; "Apply" stores it as the override
 * set and reloads so every module reads the new tables. Forms are generated from the shape of the
 * shipped entries, so new fields in the JSON show up automatically.
 */
export class ContentScreen implements Screen {
  readonly id = 'content';
  readonly title = STR.content.title;
  readonly root = el('div', { class: 'cols', style: 'flex-direction:column' });
  private tabs = el('div', {
    class: 'col-foot',
    style: 'border:none;padding:0 0 6px 0;flex-wrap:wrap',
  });
  private body = el('div', { class: 'col-body' });
  private foot = el('div', { class: 'col-foot' });
  private problems = el('div', { class: 'sub red', style: 'flex:1' });
  private draft: ContentBundle = clone(content);
  private tab: ContentKey = 'locomotives';

  constructor(private readonly onReload: () => void) {
    this.root.append(this.tabs, el('div', { class: 'col' }, this.body, this.foot));
  }
  onOpen() {
    this.draft = clone(content);
    this.render();
  }

  private render() {
    const t = this.tabs;
    t.innerHTML = '';
    for (const k of CONTENT_KEYS)
      t.append(
        btn(
          STR.content.tabs[k],
          () => {
            this.tab = k;
            this.render();
          },
          `small ${this.tab === k ? 'active' : ''}`,
        ),
      );
    t.append(
      el('span', { style: 'flex:1' }),
      el('span', {
        class: 'dim',
        text: contentIsCustom() ? STR.content.customActive : STR.content.shipped,
      }),
    );
    const b = this.body;
    b.innerHTML = '';
    switch (this.tab) {
      case 'locomotives':
      case 'wagons':
      case 'cargo':
      case 'decor':
      case 'buildings':
        b.append(
          this.listEditor(
            this.draft[this.tab] as unknown as Row[],
            DEFAULT_CONTENT[this.tab][0] as unknown as Row,
          ),
        );
        break;
      case 'stations':
        b.append(
          el('div', { class: 'col-title', text: STR.content.levels }),
          this.objectForm(
            this.draft.stations.levels as unknown as Row,
            DEFAULT_CONTENT.stations.levels as unknown as Row,
          ),
        );
        b.append(
          el('div', { class: 'col-title', text: STR.content.entries }),
          this.listEditor(
            this.draft.stations.defs as unknown as Row[],
            DEFAULT_CONTENT.stations.defs[0] as unknown as Row,
          ),
        );
        break;
      case 'contracts': {
        const { templates: _t, rarities: _r, ...cfg } = this.draft.contracts;
        const { templates: _d, rarities: _dr, ...dcfg } = DEFAULT_CONTENT.contracts;
        void _t;
        void _d;
        void _r;
        void _dr;
        b.append(
          el('div', { class: 'col-title', text: STR.content.config }),
          this.objectForm(
            cfg as unknown as Row,
            dcfg as unknown as Row,
            (k, v) => ((this.draft.contracts as unknown as Row)[k] = v),
          ),
        );
        b.append(
          el('div', { class: 'col-title', text: STR.content.entries }),
          this.listEditor(
            this.draft.contracts.templates as unknown as Row[],
            DEFAULT_CONTENT.contracts.templates[0] as unknown as Row,
          ),
        );
        b.append(
          el('div', { class: 'col-title', text: STR.settings.contractPolicy }),
          this.listEditor(
            this.draft.contracts.rarities as unknown as Row[],
            DEFAULT_CONTENT.contracts.rarities[0] as unknown as Row,
          ),
        );
        break;
      }
      case 'gacha': {
        const { banners: _b, ...cfg } = this.draft.gacha;
        const { banners: _db, ...dcfg } = DEFAULT_CONTENT.gacha;
        void _b;
        void _db;
        b.append(
          el('div', { class: 'col-title', text: STR.content.config }),
          this.objectForm(
            cfg as unknown as Row,
            dcfg as unknown as Row,
            (k, v) => ((this.draft.gacha as unknown as Row)[k] = v),
          ),
        );
        b.append(
          el('div', { class: 'col-title', text: STR.content.entries }),
          this.listEditor(
            this.draft.gacha.banners as unknown as Row[],
            DEFAULT_CONTENT.gacha.banners[0] as unknown as Row,
          ),
        );
        break;
      }
      case 'track':
        b.append(
          this.objectForm(
            this.draft.track as unknown as Row,
            DEFAULT_CONTENT.track as unknown as Row,
          ),
        );
        break;
    }
    this.renderFoot();
  }

  /** Editable field for one value; the default entry supplies the type. */
  private field(
    row: Row,
    key: string,
    sample: unknown,
    onSet?: (k: string, v: unknown) => void,
  ): HTMLElement {
    const set = (v: unknown) => {
      row[key] = v;
      onSet?.(key, v);
      this.validate();
    };
    const cur = row[key] ?? sample;
    if (typeof sample === 'boolean') {
      const i = el('input', { type: 'checkbox' }) as HTMLInputElement;
      i.checked = !!cur;
      i.addEventListener('change', () => set(i.checked));
      return i;
    }
    if (typeof sample === 'number') {
      const i = el('input', {
        class: 'text',
        type: 'number',
        step: 'any',
        value: String(cur),
        style: 'width:90px',
      }) as HTMLInputElement;
      i.addEventListener('change', () => set(Number(i.value)));
      return i;
    }
    if (typeof sample === 'string') {
      const i = el('input', {
        class: 'text',
        type: 'text',
        value: String(cur),
        style: 'width:180px',
      }) as HTMLInputElement;
      i.addEventListener('change', () => set(i.value));
      return i;
    }
    if (
      Array.isArray(sample) &&
      sample.every((x) => typeof x === 'string' || typeof x === 'number')
    ) {
      const numeric = sample.length > 0 && typeof sample[0] === 'number';
      const i = el('input', {
        class: 'text',
        type: 'text',
        value: (cur as unknown[]).join(', '),
        style: 'width:260px',
      }) as HTMLInputElement;
      i.addEventListener('change', () => {
        const parts = i.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        set(numeric ? parts.map(Number) : parts);
      });
      return i;
    }
    // nested object / array of objects: JSON
    const area = el('textarea', {
      class: 'text',
      style: 'width:100%;min-height:36px;font-family:var(--font-mono);font-size:10px',
      spellcheck: 'false',
    }) as HTMLTextAreaElement;
    area.value = JSON.stringify(cur);
    area.addEventListener('change', () => {
      try {
        set(JSON.parse(area.value));
        area.classList.remove('bad');
      } catch {
        area.classList.add('bad');
      }
    });
    return area;
  }

  private objectForm(obj: Row, sample: Row, onSet?: (k: string, v: unknown) => void): HTMLElement {
    const box = el('div', { class: 'content-form' });
    for (const key of Object.keys(sample))
      box.append(
        el(
          'label',
          { class: 'content-field' },
          el('span', { class: 'k', text: key }),
          this.field(obj, key, sample[key], onSet),
        ),
      );
    return box;
  }

  private listEditor(list: Row[], sample: Row): HTMLElement {
    const box = el('div', { class: 'content-list' });
    list.forEach((row, i) => {
      const head = el(
        'div',
        { class: 'content-head' },
        el('span', { class: 'name', text: String(row.id ?? row.name ?? i) }),
        btn(
          STR.content.duplicate,
          () => {
            const c = clone(row);
            if (typeof c.id === 'string') c.id = `${c.id}_copy`;
            list.splice(i + 1, 0, c);
            this.render();
          },
          'small',
        ),
        btn(
          STR.content.remove,
          () => {
            list.splice(i, 1);
            this.render();
          },
          'small',
        ),
      );
      box.append(el('div', { class: 'content-entry' }, head, this.objectForm(row, sample)));
    });
    box.append(
      btn(
        STR.content.add,
        () => {
          const c = clone(list[list.length - 1] ?? sample);
          if (typeof c.id === 'string') c.id = `new_${list.length + 1}`;
          list.push(c);
          this.render();
        },
        'small accent',
      ),
    );
    return box;
  }

  private validate(): string[] {
    const problems = validateContent(this.draft);
    this.problems.textContent = problems.length
      ? problems.slice(0, 4).join(' · ') + (problems.length > 4 ? ` (+${problems.length - 4})` : '')
      : '';
    return problems;
  }

  private renderFoot() {
    const f = this.foot;
    f.innerHTML = '';
    this.validate();
    const area = el('textarea', {
      class: 'text',
      style: 'width:220px;height:22px;font-family:var(--font-mono);font-size:9px',
      placeholder: STR.content.jsonHint,
      spellcheck: 'false',
    }) as HTMLTextAreaElement;
    f.append(
      this.problems,
      btn(STR.content.export, () => (area.value = JSON.stringify(this.draft)), 'small'),
      btn(
        STR.content.import,
        () => {
          try {
            const j = JSON.parse(area.value) as Partial<ContentBundle>;
            for (const k of CONTENT_KEYS)
              if (j[k] !== undefined) (this.draft as unknown as Row)[k] = j[k];
            this.render();
          } catch {
            this.problems.textContent = STR.content.badJson;
          }
        },
        'small',
      ),
      area,
      btn(
        STR.content.reset,
        () => {
          if (confirm(STR.content.confirmReset)) {
            clearContentOverrides();
            this.onReload();
          }
        },
        'small',
      ),
      btn(
        STR.content.apply,
        () => {
          const problems = this.validate();
          if (problems.length) return;
          if (writeContentOverrides(this.draft)) this.onReload();
        },
        'accent',
      ),
    );
  }
}
