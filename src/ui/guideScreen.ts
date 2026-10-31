import type { AtlasRegistry } from '../engine/atlas';
import { stationDef } from '../sim/stations';
import { supplyMode } from '../sim/supply';
import { STR } from '../strings';
import { agePictureUrl } from './ageNews';
import { el } from './dom';
import {
  guidePages,
  matchingPages,
  type GuideBlock,
  type GuidePage,
  type GuidePicture,
} from './guideContent';
import {
  emptyState,
  keyBadge,
  lineIcon,
  listDetail,
  listRow,
  note,
  searchField,
  spriteSlot,
  well,
  type FootSpec,
} from './kit';
import type { Screen } from './modal';
import { portraitImg } from './rosterPortraits';
import { spriteImg } from './spritePreview';
import { agePicture, renderParts } from './tooltipRender';

/** What a page's picture is drawn from: the portrait, the station or works frame, the age's. */
function pictureNode(p: GuidePicture, atlas: AtlasRegistry): Node | null {
  switch (p.of) {
    case 'vehicle':
      return portraitImg(p.id, 'gd-img');
    case 'station':
      return spriteImg(atlas, `structures/${stationDef(p.id).art}_1`, 1, 'gd-img');
    case 'works':
      return spriteImg(atlas, `structures/${p.id}`, 1, 'gd-img');
    case 'age':
      return agePicture(p.id, agePictureUrl(p.id));
  }
}

function drawBlock(b: GuideBlock, atlas: AtlasRegistry): HTMLElement {
  const parts = (p: Parameters<typeof renderParts>[0]) => renderParts(p, atlas);
  switch (b.kind) {
    case 'head':
      return el('h3', { class: 'gd-h', text: b.text });
    case 'text':
      return el('p', { class: 'gd-p' }, ...parts(b.parts));
    case 'steps':
    case 'list':
      return el(
        b.kind === 'steps' ? 'ol' : 'ul',
        { class: 'gd-list' },
        ...b.items.map((i) => el('li', {}, ...parts(i))),
      );
    case 'table':
      return el(
        'div',
        { class: 'gd-tw' },
        el(
          'table',
          { class: 'gd-t' },
          el('thead', {}, el('tr', {}, ...b.head.map((h) => el('th', { text: h })))),
          el(
            'tbody',
            {},
            ...b.rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, ...parts(c))))),
          ),
        ),
      );
    case 'keys':
      return el(
        'div',
        { class: 'k-keys' },
        ...b.rows.map((r) =>
          el(
            'div',
            { class: 'k-krow' },
            el('span', {}, ...r.keys.map((k) => keyBadge(k, ''))),
            el('span', { text: r.text }),
          ),
        ),
      );
    case 'diagram':
      return el('pre', { class: 'signal-diagram', text: b.text });
    case 'pictures':
      return el(
        'div',
        { class: 'gd-pics' },
        ...b.items.map((p) =>
          el(
            'figure',
            { class: 'gd-pic' },
            spriteSlot(pictureNode(p, atlas)),
            // an age's heading stands over its picture and names it
            p.of === 'age' ? null : el('figcaption', { text: p.caption }),
          ),
        ),
      );
  }
}

/**
 * The Guide: how the game works, read from the data (`guideContent.ts`). The page list stands on the
 * left with a search over it, the page on the right. The pages are built as the screen opens, so
 * they say what this game's chain and tuning do. Time runs on behind it, and the tool in hand stays.
 */
export class GuideScreen implements Screen {
  readonly id = 'guide';
  readonly title = STR.guide.title;
  readonly frameSize = 'L';
  readonly icon = 'book';
  /** it is read, not used on the map: the tool in hand stays in hand while it is up */
  readonly keepsTool = true;
  readonly formKeys = true;
  private readonly split = listDetail(280);
  readonly root = this.split.root;
  private pages: GuidePage[] = [];
  private pageId = 'first';
  private query = '';
  private readonly search = searchField({
    placeholder: STR.guide.search,
    title: STR.guide.searchLabel,
    onInput: (text) => {
      this.query = text;
      this.drawList();
    },
  });

  constructor(private readonly atlas: AtlasRegistry) {
    this.split.list.head.append(this.search.root);
    this.search.input.setAttribute('aria-label', STR.guide.searchLabel);
  }

  /** Get ready to open on a page: a part of the game that sends the player here says which. */
  show(pageId: string) {
    this.pageId = pageId;
  }

  onOpen() {
    this.pages = guidePages();
    if (!this.pages.some((p) => p.id === this.pageId)) this.pageId = this.pages[0].id;
    this.drawList();
    this.drawPage();
  }

  frameFooter(): FootSpec {
    return {
      note: STR.guide.chain(STR.menu.supplyModes[supplyMode()]),
      done: true,
    };
  }

  private pick(id: string) {
    this.pageId = id;
    this.drawList();
    this.drawPage();
  }

  private drawList() {
    const shown = matchingPages(this.pages, this.query);
    this.split.list.body.replaceChildren(
      shown.length
        ? well(
            null,
            ...shown.map((p) =>
              listRow({
                title: el('span', { class: 'gd-li' }, lineIcon(p.icon), p.title),
                on: p.id === this.pageId,
                onClick: () => this.pick(p.id),
              }),
            ),
          )
        : emptyState({ text: STR.guide.noMatch, icon: 'search' }),
    );
  }

  private drawPage() {
    const page = this.pages.find((p) => p.id === this.pageId);
    const { head, body } = this.split.detail;
    head.replaceChildren();
    if (!page) {
      body.replaceChildren(note(STR.guide.noMatch));
      return;
    }
    body.replaceChildren(
      well(
        { title: page.title, cls: 'gd-page' },
        ...page.blocks.map((b) => drawBlock(b, this.atlas)),
      ),
    );
    body.scrollTop = 0;
  }
}
