document.addEventListener('DOMContentLoaded', async () => {
    let { endpoint = 'http://127.0.0.1:5000/v1/classify' } = await browser.storage.local.get(['endpoint']);
    document.getElementById('endpoint').value = endpoint;
});

document.getElementById('save').addEventListener('click', async () => {
    const endpoint = document.getElementById('endpoint').value;
    await browser.storage.local.set({ endpoint });
    try {
        await browser.aiFilter.initConfig({ endpoint });
    } catch (e) {
        console.error('[ai-filter][options] failed to apply config', e);
    }
});
