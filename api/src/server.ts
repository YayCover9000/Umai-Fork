import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { ImportError, importRecipe } from './import';
import type { ImportConfig } from './import';

interface Config extends ImportConfig {
    webId: string;
    importApiKey: string;
    shareMessageTemplate?: string;
}

const CONFIG_PATH = `${process.env.DATA_DIR ?? '/data'}/config.json`;
const RECIPIENTS_PATH = `${process.env.DATA_DIR ?? '/data'}/recipients.json`;
// The viewer link goes to people outside the tailnet, so it must point at a publicly reachable Umai, not the NAS.
const VIEWER_BASE_URL = process.env.VIEWER_BASE_URL ?? 'https://umai.noeldemartin.com';
const UI_URL = new URL('./ui.html', import.meta.url);

interface Recipient {
    name: string;
    email: string;
}

async function readRecipients(): Promise<Recipient[]> {
    try {
        return JSON.parse(await readFile(RECIPIENTS_PATH, 'utf8'));
    } catch {
        return [];
    }
}

function validRecipients(value: unknown): Recipient[] {
    if (!Array.isArray(value)) throw new ImportError('INVALID_RECIPIENTS', 'Empfängerliste ungültig.');

    return value.map(item => {
        const name = String(item?.name ?? '').trim();
        const email = String(item?.email ?? '').trim();

        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new ImportError('INVALID_RECIPIENTS', `Ungültiger Empfänger: ${name || email}`);
        }

        return { name, email };
    });
}

async function readConfig(): Promise<Config | null> {
    try {
        return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    } catch {
        return null;
    }
}

function sendHtml(response: ServerResponse, html: string): void {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
}

function send(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
    });
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
        if (request.method === 'OPTIONS') return send(response, 204, {});

        if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
            return sendHtml(response, await readFile(UI_URL, 'utf8'));
        }

        if (request.method === 'GET' && request.url === '/health') return send(response, 200, { ok: true });

        const config = await readConfig();

        if (!config || request.headers.authorization !== `Bearer ${config.importApiKey}`) {
            return send(response, 401, { ok: false, error: 'UNAUTHORIZED', message: 'API-Key fehlt oder ist falsch.' });
        }

        if (request.method === 'GET' && request.url === '/config/status') {
            return send(response, 200, { ok: true, configured: true, webId: config.webId, cookbookUrl: config.cookbookUrl });
        }

        if (request.method === 'GET' && request.url === '/recipients') {
            return send(response, 200, {
                ok: true,
                recipients: await readRecipients(),
                shareMessageTemplate: config.shareMessageTemplate,
            });
        }

        if (request.method === 'PUT' && request.url === '/recipients') {
            const { recipients } = await readJson(request);
            const valid = validRecipients(recipients);

            await writeFile(RECIPIENTS_PATH, JSON.stringify(valid, null, 2), { mode: 0o600 });

            return send(response, 200, { ok: true, recipients: valid });
        }

        if (request.method === 'POST' && request.url === '/import') {
            const { url } = await readJson(request);
            const result = await importRecipe(config, String(url ?? ''));

            return send(response, 200, {
                ok: true,
                recipeName: result.name,
                recipeUrl: result.url,
                shared: result.shared,
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
