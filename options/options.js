document.addEventListener('DOMContentLoaded', async () => {
    const logger = await import(browser.runtime.getURL('logger.js'));
    const AiClassifier = await import(browser.runtime.getURL('modules/AiClassifier.js'));
    const defaults = await browser.storage.local.get([
        'endpoint',
        'templateName',
        'customTemplate',
        'customSystemPrompt',
        'aiParams',
        'debugLogging',
        'aiRules'
    ]);
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

    const DEFAULT_SYSTEM = 'Determine whether the email satisfies the user\'s criterion.';
    const systemBox = document.getElementById('system-instructions');
    systemBox.value = defaults.customSystemPrompt || DEFAULT_SYSTEM;
    document.getElementById('reset-system').addEventListener('click', () => {
        systemBox.value = DEFAULT_SYSTEM;
    });

    const rulesContainer = document.getElementById('rules-container');
    const addRuleBtn = document.getElementById('add-rule');

    function renderRules(rules = []) {
        rulesContainer.innerHTML = '';
        for (const rule of rules) {
            const div = document.createElement('div');
            div.className = 'rule';

            const critInput = document.createElement('input');
            critInput.type = 'text';
            critInput.placeholder = 'Criterion';
            critInput.value = rule.criterion || '';

            const tagInput = document.createElement('input');
            tagInput.type = 'text';
            tagInput.placeholder = 'Tag (e.g. $label1)';
            tagInput.value = rule.tag || '';

            const moveInput = document.createElement('input');
            moveInput.type = 'text';
            moveInput.placeholder = 'Folder URL';
            moveInput.value = rule.moveTo || '';

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'rule-actions';

            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.type = 'button';
            delBtn.addEventListener('click', () => div.remove());

            actionsDiv.appendChild(delBtn);

            div.appendChild(critInput);
            div.appendChild(tagInput);
            div.appendChild(moveInput);
            div.appendChild(actionsDiv);

            rulesContainer.appendChild(div);
        }
    }

    addRuleBtn.addEventListener('click', () => {
        renderRules([...rulesContainer.querySelectorAll('.rule')].map(el => ({
            criterion: el.children[0].value,
            tag: el.children[1].value,
            moveTo: el.children[2].value
        })).concat([{ criterion: '', tag: '', moveTo: '' }]));
    });

    renderRules(defaults.aiRules || []);

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
        const rules = [...rulesContainer.querySelectorAll('.rule')].map(el => ({
            criterion: el.children[0].value,
            tag: el.children[1].value,
            moveTo: el.children[2].value
        })).filter(r => r.criterion);
        await browser.storage.local.set({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging, aiRules: rules });
        try {
            AiClassifier.setConfig({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging });
            logger.setDebug(debugLogging);
        } catch (e) {
            logger.aiLog('[options] failed to apply config', {level: 'error'}, e);
        }
    });
});
