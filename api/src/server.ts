import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { ImportError, importRecipe } from './import';
import type { ImportConfig } from './import';

interface Config extends ImportConfig {
    webId: string;
    importApiKey: string;
    viewerBaseUrl?: string;
}

const CONFIG_PATH = `${process.env.DATA_DIR ?? '/data'}/config.json`;
const VIEWER_BASE_URL = process.env.VIEWER_BASE_URL ?? 'http://localhost:3000';

async function readConfig(): Promise<Config | null> {
    try {
        return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    } catch {
        return null;
    }
}

function send(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) chunks.push(chunk as Buffer);

    try {
        return JSON.parse(Buffer.concat(chunks).toString() || '{}');
    } catch {
        throw new ImportError('INVALID_JSON', 'Ungültiger JSON-Body.');
    }
}

createServer(async (request, response) => {
    try {
        if (request.method === 'GET' && request.url === '/health') return send(response, 200, { ok: true });

        const config = await readConfig();

        if (!config || request.headers.authorization !== `Bearer ${config.importApiKey}`) {
            return send(response, 401, { ok: false, error: 'UNAUTHORIZED', message: 'API-Key fehlt oder ist falsch.' });
        }

        if (request.method === 'GET' && request.url === '/config/status') {
            return send(response, 200, { ok: true, configured: true, webId: config.webId, cookbookUrl: config.cookbookUrl });
        }

        if (request.method === 'POST' && request.url === '/import') {
            const { url } = await readJson(request);
            const result = await importRecipe(config, String(url ?? ''));

            return send(response, 200, {
                ok: true,
                recipeName: result.name,
                recipeUrl: result.url,
                viewerUrl: `${VIEWER_BASE_URL}/viewer?url=${encodeURIComponent(result.documentUrl)}`,
            });
        }

        send(response, 404, { ok: false, error: 'NOT_FOUND' });
    } catch (error) {
        if (error instanceof ImportError) {
            return send(response, error.status, { ok: false, error: error.code, message: error.message });
        }

        console.error(error);
        send(response, 500, { ok: false, error: 'INTERNAL', message: (error as Error).message });
    }
}).listen(Number(process.env.PORT ?? 8787));
