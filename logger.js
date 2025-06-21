let debugEnabled = false;
export function setDebug(value) {
    debugEnabled = !!value;
}

function getCaller() {
    try {
        const stack = new Error().stack.split("\n");
        if (stack.length >= 3) {
            return stack[2].trim().replace(/^at\s+/, '');
        }
    } catch (e) {}
    return '';
}

export function aiLog(message, opts = {}, ...args) {
    const { level = 'log', debug = false } = opts;
    if (debug && !debugEnabled) {
        return;
    }
    const caller = getCaller();
    const prefix = caller ? `[ai-filter][${caller}]` : '[ai-filter]';
    console[level](`%c${prefix}`, 'color:#1c92d2;font-weight:bold', message, ...args);
}
