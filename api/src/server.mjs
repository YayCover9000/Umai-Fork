import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const CONFIG_PATH = `${process.env.DATA_DIR ?? '/data'}/config.json`;

async function readConfig() {
    try {
        return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    } catch {
        return null;
    }
}

function send(response, status, payload) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
}

createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') return send(response, 200, { ok: true });

    const config = await readConfig();
    if (!config || request.headers.authorization !== `Bearer ${config.importApiKey}`) {
        return send(response, 401, { ok: false, error: 'UNAUTHORIZED', message: 'API-Key fehlt oder ist falsch.' });
    }

    if (request.method === 'GET' && request.url === '/config/status') {
        return send(response, 200, { ok: true, configured: true, webId: config.webId, cookbookUrl: config.cookbookUrl });
    }

    if (request.method === 'POST' && request.url === '/import') {
        return send(response, 501, { ok: false, error: 'NOT_IMPLEMENTED', message: 'Import folgt in Phase 6.' });
    }

    send(response, 404, { ok: false, error: 'NOT_FOUND' });
}).listen(Number(process.env.PORT ?? 8787));
