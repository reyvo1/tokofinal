/**
 * A dialog that cannot be scrolled to its own buttons is broken, and no amount of green tests
 * catches it — the DOM assertion "a dialog exists" passes on a dialog whose footer is below the fold.
 *
 * Found by measuring: the Click & Collect dialog rendered 723x1490 inside a 900px viewport.
 * `.modalOverlay` used `place-items-center`, which centres a child TALLER than the viewport and
 * therefore pushes the top and the bottom off-screen symmetrically. The header was clipped and
 * "Buat voucher" sat below the fold with no scroll container in between.
 *
 * The responsive audit missed it because it only asserts on horizontal overflow, and because it ran
 * with the dialog closed. These tests therefore assert on the CSS that determines reachability, and
 * this file ships with a browser test that measures the real thing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = process.cwd();
const read = (relative) => readFileSync(`${ROOT}/${relative}`, 'utf8');
const css = read('apps/pos/app/globals.css');
const page = read('apps/pos/app/page.tsx');

/** Pull the @apply utility list out of a single .class{...} rule. */
function utilitiesFor(className) {
  const rule = new RegExp(`\\.${className}\\{([^}]*)\\}`).exec(css);
  assert.ok(rule, `globals.css must define .${className}`);
  const apply = /@apply\s+([^;]+);/.exec(rule[1]);
  assert.ok(apply, `.${className} must use @apply`);
  return apply[1].trim().split(/\s+/);
}

test('a modal overlay taller than its content must be scrollable', () => {
  const overlay = utilitiesFor('modalOverlay');

  // The overlay itself has to scroll. Without it, anything taller than the viewport is unreachable.
  assert.ok(overlay.includes('overflow-y-auto'),
    `.modalOverlay needs overflow-y-auto: got ${overlay.join(' ')}`);

  // `place-items-center` is the specific cause: it centres an over-tall child, clipping both ends.
  assert.ok(!overlay.includes('place-items-center'),
    '.modalOverlay must not use place-items-center — it centres a child taller than the viewport, '
    + 'clipping the header above and the buttons below. Use items-start + justify-items-center.');

  assert.ok(overlay.includes('fixed') && overlay.includes('inset-0'),
    '.modalOverlay must stay fixed and cover the viewport');
});

test('a modal card is height-capped and scrolls its own content', () => {
  const card = utilitiesFor('modalCard');

  // Belt and braces: even if the overlay scrolls, an uncapped card with long content (a long
  // voucher, a long branch list) can still push its own actions out of reach.
  assert.ok(card.some((u) => /^max-h-\[/.test(u)),
    `.modalCard must cap its height so long content cannot push the actions off-screen: got ${card.join(' ')}`);
  assert.ok(card.includes('overflow-y-auto'),
    `.modalCard must scroll internally: got ${card.join(' ')}`);

  const cap = card.find((u) => /^max-h-\[/.test(u));
  assert.ok(cap, `.modalCard max-h must be expressed in vh, got ${card.join(' ')}`);
  const vh = Number(/max-h-\[(\d+)vh\]/.exec(cap)[1]);
  assert.ok(vh > 40 && vh <= 92,
    `.modalCard max-h of ${vh}vh leaves too little room on a till; expected 41-92vh`);
});

test('every dialog in the POS renders a card with a reachable action row', () => {
  // The three dialogs are portalled, so the count lives at the call sites. Each must wrap its card
  // in <ModalPortal>, and the card must carry the height cap the CSS relies on.
  const portals = [...page.matchAll(/<ModalPortal\b/g)];
  assert.ok(portals.length >= 3, `expected the three POS dialogs, found ${portals.length}`);

  const cards = [...page.matchAll(/<div className="modalCard">/g)];
  assert.equal(cards.length, portals.length,
    'every <ModalPortal> must wrap a .modalCard, otherwise the card has no bounded height to scroll');

  // .modalActions is the row holding Batal/Buat voucher — the controls the UAT could not reach.
  assert.ok(page.includes('modalActions'),
    'the dialog action row (.modalActions) is what must remain reachable');

  // role/aria live in the portal component now, not at each call site.
  assert.ok(/role="dialog"/.test(portal) && /aria-modal="true"/.test(portal),
    'ModalPortal must supply role="dialog" and aria-modal="true" for every dialog it renders');
});

test('the overlay still dims the page, so the dialog stays focused', () => {
  // Guards against a "fix" that simply deletes the backdrop and breaks focus.
  const overlay = utilitiesFor('modalOverlay');
  assert.ok(overlay.some((u) => u.startsWith('bg-slate-9')),
    `.modalOverlay must keep a dimming background: got ${overlay.join(' ')}`);
});

/**
 * Two behaviours the CSS tests cannot see, both found by driving the real UI.
 */
const portal = read('apps/pos/app/modal-portal.tsx');

test('Escape closes a modal through a document listener, not an onKeyDown on the overlay', () => {
  // Measured: with the Click & Collect card open, a real Escape keypress left the dialog on screen.
  // The cause is that `.modalOverlay` is a plain div — it has no tabindex, so it is never focused,
  // so a keydown targeted at it never fires. Only a document-level listener works from any focus.
  assert.ok(/useEscapeToClose/.test(portal),
    'modal-portal must export an escape hook, or Escape silently does nothing');
  assert.ok(/document\.addEventListener\('keydown'/.test(portal),
    'escape must be handled on document, because the overlay itself is never focused');
  assert.ok(/document\.removeEventListener\('keydown'/.test(portal),
    'the escape listener must be removable, or it leaks across dialogs and double-fires onClose');
  assert.ok(!/onKeyDown=\{\(event\)[^}]*Escape/.test(portal),
    'onKeyDown on the overlay is dead code — the overlay never receives focus. Remove it so the '
    + 'next reader does not believe Escape works.');
});

test('every dialog is portalled out of the backdrop-filtered section', () => {
  // `.posWorkspaceSurface` has `backdrop-blur-xl`. backdrop-filter makes an element a containing
  // block for `position: fixed` descendants, so a modal rendered inside it anchors to that section
  // instead of the viewport. Measured: the overlay reported top=174 height=1190 in a 900px viewport.
  assert.equal(page.includes('className="modalOverlay"'), false,
    'no dialog may render .modalOverlay inline; the backdrop-filter ancestor would trap position:fixed');

  const portals = [...page.matchAll(/<ModalPortal/g)];
  assert.ok(portals.length >= 3, `expected all three POS dialogs to be portalled, found ${portals.length}`);

  assert.ok(/createPortal\([\s\S]*document\.body/.test(portal),
    'ModalPortal must render into document.body to escape the containing block');
});

test('a modal must not render during SSR', () => {
  // createPortal needs a real document. Rendering it on the server throws and takes the whole
  // cashier screen down on first paint.
  assert.ok(/const \[mounted, setMounted\] = useState\(false\)/.test(portal),
    'ModalPortal must gate on a mounted flag');
  assert.ok(/if \(!mounted\) return null;/.test(portal),
    'ModalPortal must return null before mount instead of calling createPortal without a document');
});

test('every React hook in the POS sits at the top level of a component body', () => {
  // A hook call nested inside another hook's callback is syntactically valid and semantically
  // dead: React registers it as that effect's cleanup instead of running it as a hook. The first
  // attempt put `useEscapeToClose(...)` inside the API-online probe's `useEffect` callback — tsc
  // clean, all tests green, and Escape silently did nothing.
  //
  // Two earlier attempts to catch this with text scanning were both wrong and are worth recording:
  // a brace-depth heuristic passed against the exact bug it was written for, and a paren-walk
  // flagged the CORRECT top-level calls as nested. Source text does not know what a callback is.
  // TypeScript does, so this parses and checks the real AST.
  const ts = require('typescript');

  const offenders = [];
  for (const file of ts.sys.readDirectory('apps/pos/app', ['.tsx'], undefined, undefined)) {
    const full = `${process.cwd()}/${file}`;
    const text = readFileSync(full, 'utf8');
    const source = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

    const visit = (node) => {
      // Any call whose callee name starts with `use` and is uppercase after it.
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && /^use[A-Z]/.test(node.expression.text)) {
        // Walk up. A hook is legal at the top level of a component: directly inside the function
        // body, or inside a statement that is itself at that level. Anything deeper means some
        // enclosing function will consume the call.
        let parent = node.parent;
        while (parent) {
          if (ts.isFunctionLike(parent) && !ts.isFunctionDeclaration(parent)) {
            offenders.push(`${file}:${lineOf(node)} ${node.expression.text}() is inside a function`);
            break;
          }
          if (ts.isFunctionDeclaration(parent) || ts.isSourceFile(parent)) break;
          parent = parent.parent;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.deepEqual(offenders, [],
    'a hook inside a function body is not a hook — React treats it as cleanup or ignores it');
});
