import { el } from './dom';
import { STR } from '../strings';
import {
  actionButton,
  note,
  page,
  pasteBox,
  sectionHeader,
  segmented,
  textField,
  toggleSwitch,
  well,
  type FootSpec,
} from './kit';
import type { FrameTabs, Screen } from './modal';
import type { Confirm } from './menu';
import { problemSummary, setAsideLines } from './contentReport';
import {
  TRANSFER,
  applyState,
  contentTabs,
  entryName,
  importBundle,
  type ContentTab,
} from './contentModel';
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
 * each table declares (`contentForm.ts`), so new fields in the JSON show up automatically. The
 * last tab, Transfer, takes the whole bundle out as text and brings a pasted one in.
 */
export class ContentScreen implements Screen {
  readonly id = 'content';
  readonly title = STR.content.title;
  readonly icon = 'list';
  readonly formKeys = true;
  readonly root = page();
  /** the footer is drawn again now: a field changed what Apply may do */
  redraw: () => void = () => undefined;
  private draft: ContentBundle = clone(content);
  private tab: ContentTab = 'locomotives';
  /** what the draft is refused for, read when it changes: the footer reads this, not the draft */
  private problems: string[] = [];
  /** the boxes that hold a value the form refused: framed red, and not in the draft */
  private refused = new Set<HTMLElement>();
  /** what became of the stored tables at load; fixed for the session */
  private readonly report = contentOverrideReport();
  // the box outlives a redraw of the tab: what was exported or pasted stays
  private box = pasteBox({ placeholder: STR.content.jsonHint });
  private transferNote = note('');

  constructor(
    private readonly onReload: () => void,
    /** the game's dialog, for the question before custom content goes */
    private readonly prompt: Confirm,
  ) {}
  onOpen() {
    this.draft = clone(content);
    this.box.value = '';
    this.validate();
    this.render();
  }
  frameTabs(): FrameTabs {
    return {
      tabs: contentTabs(this.report.applied),
      current: this.tab,
      pick: (id) => {
        this.tab = id as ContentTab;
        this.render();
      },
    };
  }
  frameFooter(): FootSpec {
    const state = applyState(this.problems, (p) => problemSummary(p, 4), this.refused.size);
    return {
      actions: [
        {
          label: STR.content.reset,
          danger: true,
          onClick: () => {
            void this.prompt
              .confirm(STR.content.resetTitle, STR.content.confirmReset, {
                yes: STR.prompt.discard,
                danger: true,
              })
              .then((ok) => {
                if (!ok) return;
                clearContentOverrides();
                this.onReload();
              });
          },
        },
        {
          label: STR.content.apply,
          primary: true,
          disabled: state.disabled,
          title: state.disabled ? state.note : STR.content.applyNote,
          onClick: () => this.apply(),
        },
      ],
      note: state.note,
    };
  }

  private apply() {
    if (this.validate().length) return;
    const changed = changedTables(this.draft);
    if (!Object.keys(changed).length) {
      clearContentOverrides();
      this.onReload();
    } else if (writeContentOverrides(changed)) this.onReload();
  }

  private validate(): string[] {
    this.problems = validateContent(this.draft);
    this.redraw();
    return this.problems;
  }

  /**
   * Editable field for one entry's value. A field the entry leaves out shows empty with what the
   * game uses instead; an optional flag picks between that, yes and no.
   */
  private field(row: Row, f: FormField): HTMLElement {
    const kind = kindFor(row, f);
    const text = showField(row, f, kind);
    const placeholder = f.unset ?? '';
    // a value the form refused stays in its box, framed red, until it is fixed
    const set = (box: HTMLElement, v: string) => {
      const ok = readField(row, f, kind, v);
      box.classList.toggle('bad', !ok);
      if (ok) this.refused.delete(box);
      else this.refused.add(box);
      this.validate();
    };
    if (kind === 'bool' && f.unset === undefined)
      return toggleSwitch(
        f.key,
        () => row[f.key] === true,
        (v) => {
          readField(row, f, kind, String(v));
          this.validate();
        },
      );
    if (kind === 'bool')
      return segmented({
        cls: 'small',
        options: [
          { id: '', label: placeholder },
          { id: 'true', label: STR.content.flagOn },
          { id: 'false', label: STR.content.flagOff },
        ],
        value: text,
        onChange: (id) => {
          readField(row, f, kind, id);
          this.validate();
        },
      });
    if (kind === 'json') {
      const area = pasteBox({ placeholder });
      area.classList.add('k-json');
      area.value = text;
      area.addEventListener('change', () => set(area, area.value));
      return area;
    }
    const field = textField({ value: text, placeholder });
    field.input.addEventListener('change', () => set(field.root, field.input.value));
    return field.root;
  }

  private objectForm(obj: Row, fields: FormField[]): HTMLElement {
    return el(
      'div',
      { class: 'k-fgrid' },
      ...fields.map((f) =>
        el(
          'div',
          { class: 'k-fld' },
          el('span', { class: 'k-fk', text: f.key }),
          this.field(obj, f),
        ),
      ),
    );
  }

  /** One well per entry, with its Duplicate and Remove; `template` is what "Add entry" copies into an empty list. */
  private listEditor(list: Row[], fields: FormField[], template: Row): HTMLElement[] {
    const entries = list.map((row, i) =>
      well(
        {
          title: entryName(row, i),
          right: el(
            'span',
            { class: 'k-ha' },
            actionButton(
              STR.content.duplicate,
              () => {
                const c = clone(row);
                if (typeof c.id === 'string') c.id = `${c.id}_copy`;
                list.splice(i + 1, 0, c);
                this.validate();
                this.render(true);
              },
              { cls: 'small' },
            ),
            actionButton(
              STR.content.remove,
              () => {
                list.splice(i, 1);
                this.validate();
                this.render(true);
              },
              { cls: 'small' },
            ),
          ),
        },
        this.objectForm(row, fields),
      ),
    );
    return [
      ...entries,
      el(
        'div',
        { class: 'k-btnrow' },
        actionButton(
          STR.content.add,
          () => {
            const c = clone(list[list.length - 1] ?? template);
            if (typeof c.id === 'string') c.id = `new_${list.length + 1}`;
            list.push(c);
            this.validate();
            this.render(true);
          },
          { cls: 'small', icon: 'plus' },
        ),
      ),
    ];
  }

  /** Stored tables the load set aside, one line each; nothing when there are none. */
  private aside(): HTMLElement | null {
    const lines = setAsideLines(this.report);
    if (!lines.length) return null;
    return well(
      null,
      note(STR.content.setAsideTitle),
      ...lines.map((l) => note(l.text, l.kind === 'bad' ? 'bad' : 'warn')),
    );
  }

  private table(key: ContentKey): (HTMLElement | null)[] {
    const out: (HTMLElement | null)[] = [
      note(contentIsCustom() ? STR.content.customActive : STR.content.shipped),
      this.aside(),
    ];
    for (const spec of TAB_FORMS[key]) {
      if (spec.title) out.push(sectionHeader(spec.title));
      const fields = formFields(spec);
      const target = spec.pick(this.draft);
      if (spec.list) out.push(...this.listEditor(target as Row[], fields, shippedRows(spec)[0]));
      else out.push(well(null, this.objectForm(target as Row, fields)));
    }
    return out;
  }

  /** The bundle as text, and a pasted one back in: Export fills the box, Import reads it. */
  private transfer(): HTMLElement[] {
    return [
      well(
        STR.content.transfer,
        el(
          'div',
          { class: 'k-xfer' },
          this.box,
          el(
            'div',
            { class: 'k-btncol' },
            actionButton(
              STR.content.export,
              () => {
                this.box.value = JSON.stringify(this.draft);
                this.setTransfer(null);
              },
              { cls: 'small', icon: 'export' },
            ),
            actionButton(STR.content.import, () => this.importText(), {
              cls: 'small',
              icon: 'import',
            }),
          ),
        ),
        this.transferNote,
      ),
    ];
  }

  private importText() {
    const read = importBundle(this.draft, this.box.value);
    if (!read.ok) {
      this.setTransfer(STR.content.badJson, 'bad');
      return;
    }
    this.validate();
    const left = read.skipped.length ? ` ${STR.content.skipped(read.skipped.length)}` : '';
    this.setTransfer(
      STR.content.imported(read.tables.length) + left,
      read.skipped.length ? 'warn' : '',
    );
  }

  private setTransfer(text: string | null, cls = '') {
    this.transferNote.textContent = text ?? '';
    this.transferNote.className = `k-p ${cls}`.trim();
    this.transferNote.style.display = text ? '' : 'none';
  }

  /** `keep`: the same tab drawn again (an entry added or removed) stays where it was. */
  private render(keep = false) {
    const at = keep ? this.root.scrollTop : 0;
    if (this.tab === TRANSFER) this.setTransfer(null);
    // what is on the screen is the draft again: a refused value was never in it
    this.refused.clear();
    let body: (HTMLElement | null)[];
    try {
      body = this.tab === TRANSFER ? this.transfer() : this.table(this.tab);
    } catch {
      // a table that is not in the shape the forms read (an import of nonsense): say so
      body = [well(null, note(STR.content.badShape, 'bad'))];
    }
    this.root.replaceChildren(...body.filter((n): n is HTMLElement => n !== null));
    this.redraw();
    this.root.scrollTop = at;
  }
}
