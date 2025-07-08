"use strict";

export async function detectSystemTheme() {
    try {
        const t = await browser.theme.getCurrent();
        const scheme = t?.properties?.color_scheme;
        if (scheme === 'dark' || scheme === 'light') {
            return scheme;
        }
        const color = t?.colors?.frame || t?.colors?.toolbar;
        if (color && /^#/.test(color)) {
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return lum < 0.5 ? 'dark' : 'light';
        }
    } catch {}
    return 'light';
}
