import { el, btn } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import { problemSummary, setAsideLines } from './contentReport';
import {
  TAB_FORMS,
  formFields,
  kindFor,
  readField,
  shippedRows,
  showField,
  type FormField,
  type Row,
} from './contentForm';
import {
  content,
  CONTENT_KEYS,
  validateContent,
  changedTables,
  writeContentOverrides,
  clearContentOverrides,
  contentIsCustom,
  contentOverrideReport,
  type ContentBundle,
  type ContentKey,
} from '../data/content';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * In-client content editor. Works on a copy of the live bundle; "Apply" stores the tables that
 * differ from the shipped ones as the override set and reloads so every module reads the new
 * tables. Tabs running on a stored table are marked, and stored tables the load set aside are
 * listed with the reason. Forms are generated from the shipped entries and the optional fields
 * each table declares (`contentForm.ts`), so new fields in the JSON show up automatically.
 */
export class ContentScreen implements Screen {
  readonly id = 'content';
  readonly title = STR.content.title;
  readonly root = el('div', { class: 'cols', style: 'flex-direction:column' });
  private tabs = el('div', {
    class: 'col-foot',
    style: 'border:none;padding:0 0 6px 0;flex-wrap:wrap',
  });
  /** stored tables the load set aside, one line each; empty (and hidden) when there are none */
  private aside = el('div', { class: 'content-aside' });
  private body = el('div', { class: 'col-body' });
  private foot = el('div', { class: 'col-foot' });
  private problems = el('div', { class: 'sub red', style: 'flex:1' });
  private draft: ContentBundle = clone(content);
  private tab: ContentKey = 'locomotives';
  /** what became of the stored tables at load; fixed for the session */
  private readonly report = contentOverrideReport();

  constructor(private readonly onReload: () => void) {
    this.root.append(this.tabs, this.aside, el('div', { class: 'col' }, this.body, this.foot));
  }
  onOpen() {
    this.draft = clone(content);
    this.render();
  }

  private render() {
    const t = this.tabs;
    t.innerHTML = '';
    for (const k of CONTENT_KEYS) {
      const custom = this.report.applied.includes(k);
      const tab = btn(
        STR.content.tabs[k],
        () => {
          this.tab = k;
          this.render();
        },
        `small content-tab ${this.tab === k ? 'active' : ''} ${custom ? 'custom' : ''}`,
      );
      if (custom) tab.title = STR.content.customTab;
      t.append(tab);
    }
    t.append(
      el('span', { style: 'flex:1' }),
      el('span', {
        class: 'dim',
        text: contentIsCustom() ? STR.content.customActive : STR.content.shipped,
      }),
    );
    this.renderAside();
    const b = this.body;
    b.innerHTML = '';
    for (const spec of TAB_FORMS[this.tab]) {
      if (spec.title) b.append(el('div', { class: 'col-title', text: spec.title }));
      const fields = formFields(spec);
      const target = spec.pick(this.draft);
      b.append(
        spec.list
          ? this.listEditor(target as Row[], fields, shippedRows(spec)[0])
          : this.objectForm(target as Row, fields),
      );
    }
    this.renderFoot();
  }

  private renderAside() {
    const a = this.aside;
    a.innerHTML = '';
    const lines = setAsideLines(this.report);
    if (!lines.length) return;
    a.append(el('div', { class: 'dim', text: STR.content.setAsideTitle }));
    for (const line of lines)
      a.append(
        el(
          'div',
          { class: `tip ${line.kind}` },
          el('span', { class: 'dot' }),
          el('span', { text: line.text }),
        ),
      );
  }

  /**
   * Editable field for one entry's value. A field the entry leaves out shows empty with what the
   * game uses instead; an optional flag picks between that, yes and no.
   */
  private field(row: Row, f: FormField): HTMLElement {
    const kind = kindFor(row, f);
    const text = showField(row, f, kind);
    const placeholder = f.unset ?? '';
    const set = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string) => {
      input.classList.toggle('bad', !readField(row, f, kind, v));
      this.validate();
    };
    if (kind === 'bool' && f.unset === undefined) {
      const i = el('input', { type: 'checkbox' }) as HTMLInputElement;
      i.checked = text === 'true';
      i.addEventListener('change', () => set(i, String(i.checked)));
      return i;
    }
    if (kind === 'bool') {
      const s = el(
        'select',
        { class: 'text', style: 'width:90px' },
        el('option', { value: '', text: placeholder }),
        el('option', { value: 'true', text: STR.content.flagOn }),
        el('option', { value: 'false', text: STR.content.flagOff }),
      ) as HTMLSelectElement;
      s.value = text;
      s.addEventListener('change', () => set(s, s.value));
      return s;
    }
    if (kind === 'json') {
      const area = el('textarea', {
        class: 'text',
        style: 'width:100%;min-height:36px;font-family:var(--font-mono);font-size:10px',
        spellcheck: 'false',
        placeholder,
      }) as HTMLTextAreaElement;
      area.value = text;
      area.addEventListener('change', () => set(area, area.value));
      return area;
    }
    const width = kind === 'number' ? 90 : kind === 'text' ? 180 : 260;
    const i = el('input', {
      class: 'text',
      type: kind === 'number' ? 'number' : 'text',
      value: text,
      placeholder,
      style: `width:${width}px`,
    }) as HTMLInputElement;
    if (kind === 'number') i.step = 'any';
    i.addEventListener('change', () => set(i, i.value));
    return i;
  }

  private objectForm(obj: Row, fields: FormField[]): HTMLElement {
    const box = el('div', { class: 'content-form' });
    for (const f of fields)
      box.append(
        el(
          'label',
          { class: 'content-field' },
          el('span', { class: 'k', text: f.key }),
          this.field(obj, f),
        ),
      );
    return box;
  }

  /** One form per entry; `template` is what "Add entry" copies into an empty list. */
  private listEditor(list: Row[], fields: FormField[], template: Row): HTMLElement {
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
      box.append(el('div', { class: 'content-entry' }, head, this.objectForm(row, fields)));
    });
    box.append(
      btn(
        STR.content.add,
        () => {
          const c = clone(list[list.length - 1] ?? template);
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
    this.problems.textContent = problemSummary(problems, 4);
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
          const changed = changedTables(this.draft);
          if (!Object.keys(changed).length) {
            clearContentOverrides();
            this.onReload();
          } else if (writeContentOverrides(changed)) this.onReload();
        },
        'accent',
      ),
    );
  }
}
