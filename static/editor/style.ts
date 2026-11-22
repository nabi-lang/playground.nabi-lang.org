// CodeMirror's own styles under the page's CSP (style-src 'self', no
// inline <style>): style-mod would add a <style> element to the
// document, which the policy blocks. Its rules go into play.css's own
// sheet instead, ahead of play.css's rules, so the playground's look
// wins at equal specificity and nothing inline is needed. Import this
// before any editor is made.
import { StyleModule } from "style-mod";

// play.css as loaded; a module script runs after the stylesheets before
// it, so the sheet is there.
function playSheet(): CSSStyleSheet | null {
  const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href^="/play.css"]');
  try {
    // reading cssRules throws for a sheet that is not same-origin
    return link?.sheet && link.sheet.cssRules ? link.sheet : null;
  } catch {
    return null;
  }
}

// A rule the engine cannot parse (another engine's pseudo-element)
// still takes its place, so style-mod's rule indexes stay right.
function tolerant(sheet: CSSStyleSheet): CSSStyleSheet {
  const insertRule = (rule: string, at?: number): number => {
    try { return sheet.insertRule(rule, at); } catch { return sheet.insertRule(".cm-skipped{}", at); }
  };
  return new Proxy(sheet, {
    get: (t, k) => (k === "insertRule" ? insertRule : Reflect.get(t, k, t)),
  });
}

const sheet = playSheet();
if (sheet) {
  // style-mod keeps one StyleSet per root: a root without a head that
  // "adopts" sheets made by its window's CSSStyleSheet. This root's
  // window makes play.css's sheet; adopting it again is a no-op.
  const made = tolerant(sheet);
  const host = {
    ownerDocument: { defaultView: { CSSStyleSheet: function () { return made; } } },
    adoptedStyleSheets: [] as CSSStyleSheet[],
  };
  const mount = StyleModule.mount.bind(StyleModule);
  StyleModule.mount = (root, modules, options) => mount(root === document ? (host as unknown as Document) : root, modules, options);
}
