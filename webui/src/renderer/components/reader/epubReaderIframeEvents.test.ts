import { describe, expect, it, vi } from 'vitest';
import {
  attachEpubIframeInteractions,
  createEpubKeyboardHandler,
  epubDocumentFromRenderedView,
} from './epubReaderIframeEvents';

type ListenerMap = Record<string, EventListener[]>;

function createFakeDocument() {
  const listeners: ListenerMap = {};
  const doc = {
    defaultView: { innerWidth: 300 },
    addEventListener: vi.fn((eventName: string, listener: EventListener) => {
      listeners[eventName] ??= [];
      listeners[eventName].push(listener);
    }),
  };
  return {
    doc: doc as unknown as Document,
    listeners,
  };
}

function createRendition() {
  return {
    next: vi.fn(),
    prev: vi.fn(),
    display: vi.fn(() => Promise.resolve()),
  };
}

describe('epubReaderIframeEvents', () => {
  it('finds an iframe document from either epub.js view shape', () => {
    const direct = createFakeDocument().doc;
    const nested = createFakeDocument().doc;

    expect(epubDocumentFromRenderedView({ document: direct })).toBe(direct);
    expect(epubDocumentFromRenderedView({ contents: { document: nested } })).toBe(nested);
    expect(epubDocumentFromRenderedView(null)).toBeNull();
  });

  it('turns keyboard events into rendition navigation', () => {
    const rendition = createRendition();
    const handler = createEpubKeyboardHandler(rendition);
    const right = { key: 'ArrowRight', preventDefault: vi.fn(), target: { tagName: 'BODY' } } as unknown as KeyboardEvent;
    const left = { key: 'ArrowLeft', preventDefault: vi.fn(), target: { tagName: 'BODY' } } as unknown as KeyboardEvent;
    const input = { key: 'ArrowRight', preventDefault: vi.fn(), target: { tagName: 'INPUT' } } as unknown as KeyboardEvent;

    handler(right);
    handler(left);
    handler(input);

    expect(right.preventDefault).toHaveBeenCalledOnce();
    expect(left.preventDefault).toHaveBeenCalledOnce();
    expect(input.preventDefault).not.toHaveBeenCalled();
    expect(rendition.next).toHaveBeenCalledOnce();
    expect(rendition.prev).toHaveBeenCalledOnce();
  });

  it('re-broadcasts chrome keys as commands instead of navigating', () => {
    const rendition = createRendition();
    const dispatchChromeCommand = vi.fn();
    const handler = createEpubKeyboardHandler(rendition, dispatchChromeCommand);

    const escape = { key: 'Escape', preventDefault: vi.fn(), target: { tagName: 'BODY' } } as unknown as KeyboardEvent;
    const fullscreen = { key: 'f', preventDefault: vi.fn(), target: { tagName: 'BODY' } } as unknown as KeyboardEvent;

    handler(escape);
    handler(fullscreen);

    expect(dispatchChromeCommand).toHaveBeenNthCalledWith(1, 'back');
    expect(dispatchChromeCommand).toHaveBeenNthCalledWith(2, 'fullscreen');
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(rendition.next).not.toHaveBeenCalled();
    expect(rendition.prev).not.toHaveBeenCalled();
  });

  it('leaves keys alone while a dialog/sheet owns them', () => {
    const rendition = createRendition();
    const dispatchChromeCommand = vi.fn();
    const handler = createEpubKeyboardHandler(rendition, dispatchChromeCommand);

    const inDialog = {
      key: 'Escape',
      preventDefault: vi.fn(),
      target: { tagName: 'DIV', closest: vi.fn(() => ({})) },
    } as unknown as KeyboardEvent;

    handler(inDialog);

    expect(dispatchChromeCommand).not.toHaveBeenCalled();
    expect(inDialog.preventDefault).not.toHaveBeenCalled();
  });

  it('wires an iframe document once and resolves internal links through rendition.display', () => {
    const { doc, listeners } = createFakeDocument();
    const rendition = createRendition();
    const linkedDocs = new WeakSet<Document>();
    const resolveDisplayTarget = vi.fn(() => 'chapter-target');

    attachEpubIframeInteractions({
      iframeDoc: doc,
      rendition,
      keyboardHandler: vi.fn(),
      sectionHref: 'chapter.xhtml',
      resolveDisplayTarget,
      linkedIframeDocs: linkedDocs,
      onLinkError: vi.fn(),
    });
    attachEpubIframeInteractions({
      iframeDoc: doc,
      rendition,
      keyboardHandler: vi.fn(),
      sectionHref: 'chapter.xhtml',
      resolveDisplayTarget,
      linkedIframeDocs: linkedDocs,
      onLinkError: vi.fn(),
    });

    expect(listeners.click).toHaveLength(1);
    expect(listeners.keydown).toHaveLength(1);
    expect(listeners.touchstart).toHaveLength(1);
    expect(listeners.mousedown).toHaveLength(1);
    expect(listeners.mouseup).toHaveLength(1);

    const link = { getAttribute: vi.fn(() => '#footnote') };
    const event = {
      target: { closest: vi.fn(() => link) },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as MouseEvent;

    listeners.click[0](event);

    expect(resolveDisplayTarget).toHaveBeenCalledWith('#footnote', 'chapter.xhtml');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(rendition.display).toHaveBeenCalledWith('chapter-target');
  });

  it('maps iframe swipes and taps to navigation or toolbar actions', () => {
    const { doc, listeners } = createFakeDocument();
    const rendition = createRendition();
    const dispatchToolbarToggle = vi.fn();

    attachEpubIframeInteractions({
      iframeDoc: doc,
      rendition,
      keyboardHandler: vi.fn(),
      resolveDisplayTarget: vi.fn(),
      linkedIframeDocs: new WeakSet<Document>(),
      onLinkError: vi.fn(),
      getViewportWidth: () => 300,
      dispatchToolbarToggle,
    });

    listeners.touchstart[0]({
      touches: [{ clientX: 250, clientY: 20 }],
    } as unknown as TouchEvent);
    listeners.touchend[0]({
      changedTouches: [{ clientX: 100, clientY: 25 }],
      preventDefault: vi.fn(),
      target: { closest: vi.fn(() => null) },
    } as unknown as TouchEvent);

    listeners.touchstart[0]({
      touches: [{ clientX: 150, clientY: 20 }],
    } as unknown as TouchEvent);
    const centerTap = {
      changedTouches: [{ clientX: 150, clientY: 20 }],
      preventDefault: vi.fn(),
      target: { closest: vi.fn(() => null) },
    } as unknown as TouchEvent;
    listeners.touchend[0](centerTap);

    expect(rendition.next).toHaveBeenCalledOnce();
    expect(dispatchToolbarToggle).toHaveBeenCalledOnce();
    // Handled taps suppress the browser's compatibility mouse events so the
    // mouse tap zones don't act on the same gesture twice.
    expect(centerTap.preventDefault).toHaveBeenCalledOnce();
  });

  it('maps iframe mouse clicks to the same tap zones as touch', () => {
    const { doc, listeners } = createFakeDocument();
    const rendition = createRendition();
    const dispatchToolbarToggle = vi.fn();

    attachEpubIframeInteractions({
      iframeDoc: doc,
      rendition,
      keyboardHandler: vi.fn(),
      resolveDisplayTarget: vi.fn(),
      linkedIframeDocs: new WeakSet<Document>(),
      onLinkError: vi.fn(),
      getViewportWidth: () => 300,
      dispatchToolbarToggle,
    });

    const tapAt = (downX: number, upX: number, closestResult: unknown = null) => {
      listeners.mousedown[0]({ clientX: downX, clientY: 20 } as unknown as MouseEvent);
      listeners.mouseup[0]({
        clientX: upX,
        clientY: 20,
        target: { closest: vi.fn(() => closestResult) },
      } as unknown as MouseEvent);
    };

    tapAt(50, 50); // left third → prev
    tapAt(250, 250); // right third → next
    tapAt(150, 150); // center → toolbar
    tapAt(150, 250); // drag (text selection) → ignored
    tapAt(150, 150, {}); // interactive target (link/button) → ignored

    expect(rendition.prev).toHaveBeenCalledOnce();
    expect(rendition.next).toHaveBeenCalledOnce();
    expect(dispatchToolbarToggle).toHaveBeenCalledOnce();
  });
});
