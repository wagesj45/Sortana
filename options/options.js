document.addEventListener('DOMContentLoaded', async () => {
    const storage = (globalThis.messenger ?? browser).storage;
    const logger = await import(browser.runtime.getURL('logger.js'));
    const AiClassifier = await import(browser.runtime.getURL('modules/AiClassifier.js'));
    const dataTransfer = await import(browser.runtime.getURL('options/dataTransfer.js'));
    const { detectSystemTheme } = await import(browser.runtime.getURL('modules/themeUtils.js'));
    const { DEFAULT_AI_PARAMS } = await import(browser.runtime.getURL('modules/defaultParams.js'));
    const defaults = await storage.local.get([
        'endpoint',
        'templateName',
        'customTemplate',
        'customSystemPrompt',
        'aiParams',
        'debugLogging',
        'htmlToMarkdown',
        'stripUrlParams',
        'altTextImages',
        'collapseWhitespace',
        'aiRules',
        'aiCache',
        'theme'
    ]);
    const tabButtons = document.querySelectorAll('#main-tabs li');
    const tabs = document.querySelectorAll('.tab-content');
    tabButtons.forEach(btn => btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        tabs.forEach(tab => {
            tab.classList.toggle('is-hidden', tab.id !== `${btn.dataset.tab}-tab`);
        });
    }));
    tabButtons[0]?.click();

    const saveBtn = document.getElementById('save');
    let initialized = false;
    let dragRule = null;
    function markDirty() {
        if (initialized) saveBtn.disabled = false;
    }
    document.addEventListener('input', markDirty, true);
    document.addEventListener('change', markDirty, true);
    logger.setDebug(defaults.debugLogging === true);

    const themeSelect = document.getElementById('theme-select');
    themeSelect.value = defaults.theme || 'auto';

    function updateIcons(theme) {
        document.querySelectorAll('img[data-icon]').forEach(img => {
            const name = img.dataset.icon;
            const size = img.dataset.size || 16;
            if (name === 'full-logo') {
                img.src = `../resources/img/full-logo${theme === 'dark' ? '-white' : ''}.png`;
            } else {
                img.src = `../resources/img/${name}-${theme}-${size}.png`;
            }
        });
    }

    async function applyTheme(setting) {
        const mode = setting === 'auto' ? await detectSystemTheme() : setting;
        document.documentElement.dataset.theme = mode;
        updateIcons(mode);
    }

    await applyTheme(themeSelect.value);
    themeSelect.addEventListener('change', async () => {
        markDirty();
        await applyTheme(themeSelect.value);
    });
    document.getElementById('endpoint').value = defaults.endpoint || 'http://127.0.0.1:5000/v1/completions';

    const templates = {
        openai: browser.i18n.getMessage('template.openai'),
        qwen: browser.i18n.getMessage('template.qwen'),
        mistral: browser.i18n.getMessage('template.mistral'),
        custom: browser.i18n.getMessage('template.custom')
    };
    const templateSelect = document.getElementById('template');
    for (const [value, label] of Object.entries(templates)) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        templateSelect.appendChild(opt);
    }
    templateSelect.value = defaults.templateName || 'openai';

    const customBox = document.getElementById('custom-template-container');
    const customTemplate = document.getElementById('custom-template');
    customTemplate.value = defaults.customTemplate || '';

    function updateVisibility() {
        customBox.classList.toggle('is-hidden', templateSelect.value !== 'custom');
    }
    templateSelect.addEventListener('change', updateVisibility);
    updateVisibility();

    const advancedBox = document.getElementById('advanced-options');
    const advancedBtn = document.getElementById('toggle-advanced');
    advancedBtn.addEventListener('click', () => {
        advancedBox.classList.toggle('is-hidden');
    });

    const debugToggle = document.getElementById('debug-logging');
    debugToggle.checked = defaults.debugLogging === true;

    const htmlToggle = document.getElementById('html-to-markdown');
    htmlToggle.checked = defaults.htmlToMarkdown === true;

    const stripUrlToggle = document.getElementById('strip-url-params');
    stripUrlToggle.checked = defaults.stripUrlParams === true;

    const altTextToggle = document.getElementById('alt-text-images');
    altTextToggle.checked = defaults.altTextImages === true;

    const collapseWhitespaceToggle = document.getElementById('collapse-whitespace');
    collapseWhitespaceToggle.checked = defaults.collapseWhitespace === true;

    const aiParams = Object.assign({}, DEFAULT_AI_PARAMS, defaults.aiParams || {});
    for (const [key, val] of Object.entries(aiParams)) {
        const el = document.getElementById(key);
        if (el) el.value = val;
    }

    let tagList = [];
    let folderList = [];
    try {
        tagList = await messenger.messages.tags.list();
    } catch (e) {
        logger.aiLog('failed to list tags', {level:'error'}, e);
    }
    try {
        const accounts = await messenger.accounts.list(true);
        const collect = (f, prefix='') => {
            folderList.push({ id: f.id ?? f.path, name: prefix + f.name });
            (f.subFolders || []).forEach(sf => collect(sf, prefix + f.name + '/'));
        };
        for (const acct of accounts) {
            (acct.folders || []).forEach(f => collect(f, `${acct.name}/`));
        }
    } catch (e) {
        logger.aiLog('failed to list folders', {level:'error'}, e);
    }

    const DEFAULT_SYSTEM = 'Determine whether the email satisfies the user\'s criterion.';
    const systemBox = document.getElementById('system-instructions');
    systemBox.value = defaults.customSystemPrompt || DEFAULT_SYSTEM;
    document.getElementById('reset-system').addEventListener('click', () => {
        systemBox.value = DEFAULT_SYSTEM;
    });

    const rulesContainer = document.getElementById('rules-container');
    const addRuleBtn = document.getElementById('add-rule');

    const ruleCountEl = document.getElementById('rule-count');
    const cacheCountEl = document.getElementById('cache-count');
    const queueCountEl = document.getElementById('queue-count');
    const currentTimeEl = document.getElementById('current-time');
    const lastTimeEl = document.getElementById('last-time');
    const averageTimeEl = document.getElementById('average-time');
    const totalTimeEl = document.getElementById('total-time');
    const perHourEl = document.getElementById('per-hour');
    const perDayEl = document.getElementById('per-day');
    let timingLogged = false;
    ruleCountEl.textContent = (defaults.aiRules || []).length;
    cacheCountEl.textContent = defaults.aiCache ? Object.keys(defaults.aiCache).length : 0;

    function createActionRow(action = {type: 'tag'}) {
        const row = document.createElement('div');
        row.className = 'action-row field is-grouped mb-2';

        const typeWrapper = document.createElement('div');
        typeWrapper.className = 'select is-small mr-2';
        const typeSelect = document.createElement('select');
        ['tag','move','junk','read','flag'].forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            typeSelect.appendChild(opt);
        });
        typeSelect.value = action.type;
        typeWrapper.appendChild(typeSelect);

        const paramSpan = document.createElement('span');

        function updateParams() {
            paramSpan.innerHTML = '';
            if (typeSelect.value === 'tag') {
                const wrap = document.createElement('div');
                wrap.className = 'select is-small';
                const sel = document.createElement('select');
                sel.className = 'tag-select';
                for (const t of tagList) {
                    const opt = document.createElement('option');
                    opt.value = t.key;
                    opt.textContent = t.tag;
                    sel.appendChild(opt);
                }
                sel.value = action.tagKey || '';
                wrap.appendChild(sel);
                paramSpan.appendChild(wrap);
            } else if (typeSelect.value === 'move') {
                const wrap = document.createElement('div');
                wrap.className = 'select is-small';
                const sel = document.createElement('select');
                sel.className = 'folder-select';
                for (const f of folderList) {
                    const opt = document.createElement('option');
                    opt.value = f.id;
                    opt.textContent = f.name;
                    sel.appendChild(opt);
                }
                sel.value = action.folder || '';
                wrap.appendChild(sel);
                paramSpan.appendChild(wrap);
            } else if (typeSelect.value === 'junk') {
                const wrap = document.createElement('div');
                wrap.className = 'select is-small';
                const sel = document.createElement('select');
                sel.className = 'junk-select';
                sel.appendChild(new Option('mark junk','true'));
                sel.appendChild(new Option('mark not junk','false'));
                sel.value = String(action.junk ?? true);
                wrap.appendChild(sel);
                paramSpan.appendChild(wrap);
            } else if (typeSelect.value === 'read') {
                const wrap = document.createElement('div');
                wrap.className = 'select is-small';
                const sel = document.createElement('select');
                sel.className = 'read-select';
                sel.appendChild(new Option('mark read','true'));
                sel.appendChild(new Option('mark unread','false'));
                sel.value = String(action.read ?? true);
                wrap.appendChild(sel);
                paramSpan.appendChild(wrap);
            } else if (typeSelect.value === 'flag') {
                const wrap = document.createElement('div');
                wrap.className = 'select is-small';
                const sel = document.createElement('select');
                sel.className = 'flag-select';
                sel.appendChild(new Option('flag','true'));
                sel.appendChild(new Option('unflag','false'));
                sel.value = String(action.flagged ?? true);
                wrap.appendChild(sel);
                paramSpan.appendChild(wrap);
            }
        }

        typeSelect.addEventListener('change', updateParams);
        updateParams();

        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.type = 'button';
        removeBtn.className = 'button is-small is-danger is-light';
        removeBtn.addEventListener('click', () => row.remove());

        row.appendChild(typeWrapper);
        row.appendChild(paramSpan);
        row.appendChild(removeBtn);

        return row;
    }

    function renderRules(rules = []) {
        ruleCountEl.textContent = rules.length;
        rulesContainer.innerHTML = '';
        for (const rule of rules) {
            const article = document.createElement('article');
            article.className = 'rule message mb-4';
            article.draggable = true;
            article.addEventListener('dragstart', ev => { dragRule = article; ev.dataTransfer.setData('text/plain', ''); });
            article.addEventListener('dragover', ev => ev.preventDefault());
            article.addEventListener('drop', ev => {
                ev.preventDefault();
                if (dragRule && dragRule !== article) {
                    const children = Array.from(rulesContainer.children);
                    const dragIndex = children.indexOf(dragRule);
                    const dropIndex = children.indexOf(article);
                    if (dragIndex < dropIndex) {
                        rulesContainer.insertBefore(dragRule, article.nextSibling);
                    } else {
                        rulesContainer.insertBefore(dragRule, article);
                    }
                    markDirty();
                }
            });

            const critInput = document.createElement('input');
            critInput.type = 'text';
            critInput.placeholder = 'Criterion';
            critInput.value = rule.criterion || '';
            critInput.className = 'input criterion mr-2';
            critInput.style.flexGrow = '1';

            const header = document.createElement('div');
            header.className = 'message-header';
            header.appendChild(critInput);

            const delBtn = document.createElement('button');
            delBtn.className = 'delete';
            delBtn.setAttribute('aria-label', 'delete');
            delBtn.addEventListener('click', () => {
                article.remove();
                ruleCountEl.textContent = rulesContainer.querySelectorAll('.rule').length;
            });
            header.appendChild(delBtn);

            const actionsContainer = document.createElement('div');
            actionsContainer.className = 'rule-actions mb-2';

            for (const act of (rule.actions || [])) {
                actionsContainer.appendChild(createActionRow(act));
            }

            const addAction = document.createElement('button');
            addAction.textContent = 'Add Action';
            addAction.type = 'button';
            addAction.className = 'button is-small mb-2';
            addAction.addEventListener('click', () => actionsContainer.appendChild(createActionRow()));

           const stopLabel = document.createElement('label');
           stopLabel.className = 'checkbox mt-2';
           const stopCheck = document.createElement('input');
           stopCheck.type = 'checkbox';
           stopCheck.className = 'stop-processing';
           stopCheck.checked = rule.stopProcessing === true;
           stopLabel.appendChild(stopCheck);
           stopLabel.append(' Stop after match');

            const unreadLabel = document.createElement('label');
            unreadLabel.className = 'checkbox mt-2 ml-4';
            const unreadCheck = document.createElement('input');
            unreadCheck.type = 'checkbox';
            unreadCheck.className = 'unread-only';
            unreadCheck.checked = rule.unreadOnly === true;
            unreadLabel.appendChild(unreadCheck);
            unreadLabel.append(' Only apply to unread messages');

            const body = document.createElement('div');
            body.className = 'message-body';
            body.appendChild(actionsContainer);
            body.appendChild(addAction);
            body.appendChild(stopLabel);
            body.appendChild(unreadLabel);

            article.appendChild(header);
            article.appendChild(body);

            rulesContainer.appendChild(article);
        }
    }

    addRuleBtn.addEventListener('click', () => {
        const data = [...rulesContainer.querySelectorAll('.rule')].map(ruleEl => {
            const criterion = ruleEl.querySelector('.criterion').value;
            const actions = [...ruleEl.querySelectorAll('.action-row')].map(row => {
                const type = row.querySelector('select').value;
                if (type === 'tag') {
                    return { type, tagKey: row.querySelector('.tag-select').value };
                }
                if (type === 'move') {
                    return { type, folder: row.querySelector('.folder-select').value };
                }
                if (type === 'junk') {
                    return { type, junk: row.querySelector('.junk-select').value === 'true' };
                }
                if (type === 'read') {
                    return { type, read: row.querySelector('.read-select').value === 'true' };
                }
                if (type === 'flag') {
                    return { type, flagged: row.querySelector('.flag-select').value === 'true' };
                }
                return { type };
            });
            const stopProcessing = ruleEl.querySelector('.stop-processing')?.checked;
            const unreadOnly = ruleEl.querySelector('.unread-only')?.checked;
            return { criterion, actions, unreadOnly, stopProcessing };
        });
        data.push({ criterion: '', actions: [], unreadOnly: false, stopProcessing: false });
        renderRules(data);
    });

    renderRules((defaults.aiRules || []).map(r => {
        if (r.actions) return r;
        const actions = [];
        if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
        if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
        const rule = { criterion: r.criterion, actions };
        if (r.stopProcessing) rule.stopProcessing = true;
        if (r.unreadOnly) rule.unreadOnly = true;
        return rule;
    }));


    function format(ms) {
        if (ms < 0) return '--:--:--';
        let totalSec = Math.floor(ms / 1000);
        const sec = totalSec % 60;
        totalSec = (totalSec - sec) / 60;
        const min = totalSec % 60;
        const hr = (totalSec - min) / 60;
        return `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    async function refreshMaintenance() {
        try {
            const stats = await browser.runtime.sendMessage({ type: 'sortana:getTiming' });
            queueCountEl.textContent = stats.count;
            currentTimeEl.classList.remove('has-text-danger');
            lastTimeEl.classList.remove('has-text-success','has-text-danger');
            let arrow = '';
            if (stats.last >= 0) {
                if (stats.stddev > 0 && stats.last - stats.average > stats.stddev) {
                    lastTimeEl.classList.add('has-text-danger');
                    arrow = ' ▲';
                } else if (stats.stddev > 0 && stats.average - stats.last > stats.stddev) {
                    lastTimeEl.classList.add('has-text-success');
                    arrow = ' ▼';
                }
                lastTimeEl.textContent = format(stats.last) + arrow;
            } else {
                lastTimeEl.textContent = '--:--:--';
            }
            if (stats.current >= 0) {
                if (stats.stddev > 0 && stats.current - stats.average > stats.stddev) {
                    currentTimeEl.classList.add('has-text-danger');
                }
                currentTimeEl.textContent = format(stats.current);
            } else {
                currentTimeEl.textContent = '--:--:--';
            }
            averageTimeEl.textContent = stats.runs > 0 ? format(stats.average) : '--:--:--';
            totalTimeEl.textContent = format(stats.total);
            const perHour = stats.average > 0 ? Math.round(3600000 / stats.average) : 0;
            const perDay = stats.average > 0 ? Math.round(86400000 / stats.average) : 0;
            perHourEl.textContent = perHour;
            perDayEl.textContent = perDay;
            if (!timingLogged) {
                logger.aiLog('retrieved timing stats', {debug: true});
                timingLogged = true;
            }
        } catch (e) {
            queueCountEl.textContent = '?';
            currentTimeEl.textContent = '--:--:--';
            lastTimeEl.textContent = '--:--:--';
            averageTimeEl.textContent = '--:--:--';
            totalTimeEl.textContent = '--:--:--';
            perHourEl.textContent = '0';
            perDayEl.textContent = '0';
        }

        try {
            const { aiCache } = await storage.local.get('aiCache');
            cacheCountEl.textContent = aiCache ? Object.keys(aiCache).length : 0;
        } catch {
            cacheCountEl.textContent = '?';
        }
    }

    refreshMaintenance();
    setInterval(refreshMaintenance, 1000);

    document.getElementById('clear-cache').addEventListener('click', async () => {
        await AiClassifier.clearCache();
        cacheCountEl.textContent = '0';
    });

    function selectedCategories() {
        return [...document.querySelectorAll('.transfer-category:checked')].map(el => el.value);
    }

    document.getElementById('export-data').addEventListener('click', () => {
        dataTransfer.exportData(selectedCategories());
    });

    const importInput = document.getElementById('import-file');
    document.getElementById('import-data').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async () => {
        if (importInput.files.length) {
            await dataTransfer.importData(importInput.files[0], selectedCategories());
            location.reload();
        }
    });

    initialized = true;

    document.getElementById('save').addEventListener('click', async () => {
        const endpoint = document.getElementById('endpoint').value;
        const templateName = templateSelect.value;
        const customTemplateText = customTemplate.value;
        const customSystemPrompt = systemBox.value;
        const aiParamsSave = {};
        for (const key of Object.keys(DEFAULT_AI_PARAMS)) {
            const el = document.getElementById(key);
            if (el) {
                const num = parseFloat(el.value);
                aiParamsSave[key] = isNaN(num) ? DEFAULT_AI_PARAMS[key] : num;
            }
        }
        const debugLogging = debugToggle.checked;
        const htmlToMarkdown = htmlToggle.checked;
        const rules = [...rulesContainer.querySelectorAll('.rule')].map(ruleEl => {
            const criterion = ruleEl.querySelector('.criterion').value;
            const actions = [...ruleEl.querySelectorAll('.action-row')].map(row => {
                const type = row.querySelector('select').value;
                if (type === 'tag') {
                    return { type, tagKey: row.querySelector('.tag-select').value };
                }
                if (type === 'move') {
                    return { type, folder: row.querySelector('.folder-select').value };
                }
                if (type === 'junk') {
                    return { type, junk: row.querySelector('.junk-select').value === 'true' };
                }
                if (type === 'read') {
                    return { type, read: row.querySelector('.read-select').value === 'true' };
                }
                if (type === 'flag') {
                    return { type, flagged: row.querySelector('.flag-select').value === 'true' };
                }
                return { type };
            });
            const stopProcessing = ruleEl.querySelector('.stop-processing')?.checked;
            const unreadOnly = ruleEl.querySelector('.unread-only')?.checked;
            return { criterion, actions, unreadOnly, stopProcessing };
        }).filter(r => r.criterion);
        const stripUrlParams = stripUrlToggle.checked;
        const altTextImages = altTextToggle.checked;
        const collapseWhitespace = collapseWhitespaceToggle.checked;
        const theme = themeSelect.value;
        await storage.local.set({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging, htmlToMarkdown, stripUrlParams, altTextImages, collapseWhitespace, aiRules: rules, theme });
        await applyTheme(theme);
        try {
            await AiClassifier.setConfig({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging });
            logger.setDebug(debugLogging);
        } catch (e) {
            logger.aiLog('[options] failed to apply config', {level: 'error'}, e);
        }
        saveBtn.disabled = true;
    });
});
