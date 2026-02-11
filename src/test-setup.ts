// Polyfill Obsidian's setCssStyles for jsdom test environment
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.setCssStyles) {
    HTMLElement.prototype.setCssStyles = function (styles: Partial<CSSStyleDeclaration>) {
        Object.assign(this.style, styles);
    };
}
