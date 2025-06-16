document.addEventListener('DOMContentLoaded', async () => {
    const defaults = await browser.storage.local.get([
        'endpoint',
        'templateName',
        'customTemplate',
        'customSystemPrompt'
    ]);
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
        await browser.storage.local.set({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt });
        try {
            await browser.aiFilter.initConfig({ endpoint, templateName, customTemplate: customTemplateText, customSystemPrompt });
        } catch (e) {
            console.error('[ai-filter][options] failed to apply config', e);
        }
    });
});
