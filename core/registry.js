// ============================================================
// core/registry.js — Element plugin registry.
// Validates every module against the element contract at
// registration time so a broken element fails at startup.
//
// ELEMENT CONTRACT — each element module exports:
//   type         : unique string key ('text', 'shape', ...)
//   label        : toolbar label
//   icon         : emoji/icon for the toolbar button
//   className    : base CSS class for the element wrapper
//   defaults(ctx)-> object with type-specific default properties
//   renderDom(domEl, el, ctx) : paint the element (ctx.context =
//                   'canvas' | 'thumb'; wire events only for canvas)
//   exportInner(el) : return inner HTML string for exports
//   properties(el, elIndex) : type-specific properties-panel HTML
//   toolbar      : optional; false hides the toolbar "add" button
//   actions      : optional { name: fn(elIndex, arg) }. A button in
//                  properties() HTML with data-element-action="name"
//                  (and optional data-arg="...") runs it on click.
//
// properties() HTML uses no inline handlers: a control with
// data-prop="fontSize" updates that property of the selection
// (selects on change, other inputs while typing).
//
// .gl SERIALIZATION — element properties are whitelisted in
// core/gl/glformat.js (SCHEMAS). When adding a new element type,
// add its schema entry there too; unregistered types throw a
// friendly error at .gl parse time and serialize best-effort.
// ============================================================

const definitions = new Map();

const REQUIRED = ['type', 'label', 'icon', 'defaults', 'renderDom', 'exportInner', 'properties'];

export const ElementRegistry = {
    register(def) {
        for (const key of REQUIRED) {
            if (typeof def[key] === 'undefined') {
                throw new Error(`Element '${def.type || '?'}' missing required contract member: ${key}`);
            }
        }
        if (definitions.has(def.type)) {
            throw new Error(`Duplicate element type registered: '${def.type}'`);
        }
        definitions.set(def.type, def);
    },

    get(type) {
        return definitions.get(type) || null;
    },

    types() {
        return [...definitions.values()];
    },

    /** Runs an element action (from a data-element-action button). */
    callAction(type, action, elIndex, payload) {
        const def = definitions.get(type);
        if (def && def.actions && typeof def.actions[action] === 'function') {
            return def.actions[action](elIndex, payload);
        }
        console.warn(`Unknown element action: ${type}.${action}`);
    },
};
