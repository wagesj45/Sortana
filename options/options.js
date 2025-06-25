document.addEventListener('DOMContentLoaded', async () => {
    const logger = await import(browser.runtime.getURL('logger.js'));
    const AiClassifier = await import(browser.runtime.getURL('modules/AiClassifier.js'));
    const defaults = await browser.storage.local.get([
        'endpoint',
        'templateName',
        'customTemplate',
        'customSystemPrompt',
        'aiParams',
        'debugLogging'
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
        await browser.storage.local.set({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging });
        try {
            await browser.aiFilter.initConfig({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging });
            AiClassifier.setConfig({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt, aiParams: aiParamsSave, debugLogging });
            logger.setDebug(debugLogging);
        } catch (e) {
            logger.aiLog('[options] failed to apply config', {level: 'error'}, e);
        }
    });
});
