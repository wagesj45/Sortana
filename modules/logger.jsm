var EXPORTED_SYMBOLS = ['aiLog', 'setDebug'];
let debugEnabled = false;

function setDebug(value) {
    debugEnabled = !!value;
}

function getCaller() {
    try {
        let stack = new Error().stack.split('\n');
        if (stack.length >= 3) {
            return stack[2].trim().replace(/^@?\s*\(?/,'').replace(/^at\s+/, '');
        }
    } catch (e) {}
    return '';
}

function aiLog(message, opts = {}, ...args) {
    const { level = 'log', debug = false } = opts;
    if (debug && !debugEnabled) {
        return;
    }
    const caller = getCaller();
    const prefix = caller ? `[ai-filter][${caller}]` : '[ai-filter]';
    console[level](`%c${prefix}`, 'color:#1c92d2;font-weight:bold', message, ...args);
}
