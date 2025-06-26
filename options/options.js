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
        'aiRules'
    ]);
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabs = document.querySelectorAll('.tab');
    tabButtons.forEach(btn => btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tabs.forEach(tab => {
            tab.style.display = tab.id === `${btn.dataset.tab}-tab` ? 'block' : 'none';
        });
    }));
    tabButtons[0]?.click();
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
        customBox.style.display = templateSelect.value === 'custom' ? 'block' : 'none';
    }
    templateSelect.addEventListener('change', updateVisibility);
    updateVisibility();

    const advancedBox = document.getElementById('advanced-options');
    const advancedBtn = document.getElementById('toggle-advanced');
    advancedBtn.addEventListener('click', () => {
        advancedBox.style.display = advancedBox.style.display === 'none' ? 'block' : 'none';
    });

    const debugToggle = document.getElementById('debug-logging');
    debugToggle.checked = defaults.debugLogging === true;

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
        row.className = 'action-row';

        const typeSelect = document.createElement('select');
        ['tag','move','junk'].forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            typeSelect.appendChild(opt);
        });
        typeSelect.value = action.type;

        const paramSpan = document.createElement('span');

        function updateParams() {
            paramSpan.innerHTML = '';
            if (typeSelect.value === 'tag') {
                const sel = document.createElement('select');
                sel.className = 'tag-select';
                for (const t of tagList) {
                    const opt = document.createElement('option');
                    opt.value = t.key;
                    opt.textContent = t.tag;
                    sel.appendChild(opt);
                }
                sel.value = action.tagKey || '';
                paramSpan.appendChild(sel);
            } else if (typeSelect.value === 'move') {
                const sel = document.createElement('select');
                sel.className = 'folder-select';
                for (const f of folderList) {
                    const opt = document.createElement('option');
                    opt.value = f.id;
                    opt.textContent = f.name;
                    sel.appendChild(opt);
                }
                sel.value = action.folder || '';
                paramSpan.appendChild(sel);
            } else if (typeSelect.value === 'junk') {
                const sel = document.createElement('select');
                sel.className = 'junk-select';
                sel.appendChild(new Option('mark junk','true'));
                sel.appendChild(new Option('mark not junk','false'));
                sel.value = String(action.junk ?? true);
                paramSpan.appendChild(sel);
            }
        }

        typeSelect.addEventListener('change', updateParams);
        updateParams();

        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => row.remove());

        row.appendChild(typeSelect);
        row.appendChild(paramSpan);
        row.appendChild(removeBtn);

        return row;
    }

    function renderRules(rules = []) {
        rulesContainer.innerHTML = '';
        for (const rule of rules) {
            const div = document.createElement('div');
            div.className = 'rule';

            const critInput = document.createElement('input');
            critInput.type = 'text';
            critInput.placeholder = 'Criterion';
            critInput.value = rule.criterion || '';
            critInput.className = 'criterion';

            const actionsContainer = document.createElement('div');
            actionsContainer.className = 'rule-actions';

            for (const act of (rule.actions || [])) {
                actionsContainer.appendChild(createActionRow(act));
            }

            const addAction = document.createElement('button');
            addAction.textContent = 'Add Action';
            addAction.type = 'button';
            addAction.addEventListener('click', () => actionsContainer.appendChild(createActionRow()));

            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete Rule';
            delBtn.type = 'button';
            delBtn.addEventListener('click', () => div.remove());

            div.appendChild(critInput);
            div.appendChild(actionsContainer);
            div.appendChild(addAction);
            div.appendChild(delBtn);

            rulesContainer.appendChild(div);
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
            return { criterion, actions };
        });
        data.push({ criterion: '', actions: [] });
        renderRules(data);
    });

    renderRules((defaults.aiRules || []).map(r => {
        if (r.actions) return r;
        const actions = [];
        if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
        if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
        return { criterion: r.criterion, actions };
    }));

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
            return { criterion, actions };
        }).filter(r => r.criterion);
        await storage.local.set({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging, aiRules: rules });
        try {
            await AiClassifier.setConfig({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging });
            logger.setDebug(debugLogging);
        } catch (e) {
            logger.aiLog('[options] failed to apply config', {level: 'error'}, e);
        }
    });
});
