document.addEventListener('DOMContentLoaded', async () => {
    const storage = (globalThis.messenger ?? browser).storage;
    const logger = await import(browser.runtime.getURL('logger.js'));
    const AiClassifier = await import(browser.runtime.getURL('modules/AiClassifier.js'));
    const defaults = await storage.local.get([
        'endpoint',
        'templateName',
        'customTemplate',
        'customSystemPrompt',
        'aiParams',
        'debugLogging',
        'htmlToMarkdown',
        'aiRules',
        'aiCache'
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
    const DEFAULT_AI_PARAMS = {
        max_tokens: 4096,
        temperature: 0.6,
        top_p: 0.95,
        seed: -1,
        repetition_penalty: 1.0,
        top_k: 20,
        min_p: 0,
        presence_penalty: 0,
        frequency_penalty: 0,
        typical_p: 1,
        tfs: 1
    };
    document.getElementById('endpoint').value = defaults.endpoint || 'http://127.0.0.1:5000/v1/classify';

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

    function createActionRow(action = {type: 'tag'}) {
        const row = document.createElement('div');
        row.className = 'action-row field is-grouped mb-2';

        const typeWrapper = document.createElement('div');
        typeWrapper.className = 'select is-small mr-2';
        const typeSelect = document.createElement('select');
        ['tag','move','junk'].forEach(t => {
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
            delBtn.addEventListener('click', () => article.remove());
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

            const body = document.createElement('div');
            body.className = 'message-body';
            body.appendChild(actionsContainer);
            body.appendChild(addAction);
            body.appendChild(stopLabel);

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
                return { type };
            });
            const stopProcessing = ruleEl.querySelector('.stop-processing')?.checked;
            return { criterion, actions, stopProcessing };
        });
        data.push({ criterion: '', actions: [], stopProcessing: false });
        renderRules(data);
    });

    renderRules((defaults.aiRules || []).map(r => {
        if (r.actions) return r;
        const actions = [];
        if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
        if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
        const rule = { criterion: r.criterion, actions };
        if (r.stopProcessing) rule.stopProcessing = true;
        return rule;
    }));

    const ruleCountEl = document.getElementById('rule-count');
    const cacheCountEl = document.getElementById('cache-count');
    const queueCountEl = document.getElementById('queue-count');
    const currentTimeEl = document.getElementById('current-time');
    const lastTimeEl = document.getElementById('last-time');
    const averageTimeEl = document.getElementById('average-time');
    const totalTimeEl = document.getElementById('total-time');
    let timingLogged = false;
    ruleCountEl.textContent = (defaults.aiRules || []).length;
    cacheCountEl.textContent = defaults.aiCache ? Object.keys(defaults.aiCache).length : 0;

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
        }

        ruleCountEl.textContent = document.querySelectorAll('#rules-container .rule').length;
        try {
            cacheCountEl.textContent = await AiClassifier.getCacheSize();
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
                return { type };
            });
            const stopProcessing = ruleEl.querySelector('.stop-processing')?.checked;
            return { criterion, actions, stopProcessing };
        }).filter(r => r.criterion);
        await storage.local.set({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging, htmlToMarkdown, aiRules: rules });
        try {
            await AiClassifier.setConfig({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging });
            logger.setDebug(debugLogging);
        } catch (e) {
            logger.aiLog('[options] failed to apply config', {level: 'error'}, e);
        }
        saveBtn.disabled = true;
    });
});
