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
const SETTINGS_PATH = `${process.env.DATA_DIR ?? '/data'}/settings.json`;
const HISTORY_PATH = `${process.env.DATA_DIR ?? '/data'}/history.json`;
const HISTORY_LIMIT = 200;
// `tailscale serve` adds Tailscale-User-Login for tailnet requests. The tailnet can include devices shared by other
// accounts, so only explicitly listed logins skip the API key. Empty (default) means the key is always required.
const ALLOWED_LOGINS = (process.env.ALLOWED_TAILSCALE_LOGINS ?? '')
    .split(',')
    .map(login => login.trim().toLowerCase())
    .filter(Boolean);

interface HistoryEntry {
    id: string;
    at: string;
    url: string;
    ok: boolean;
    [key: string]: unknown;
}

async function readFileJson<T>(path: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeFileJson(path: string, value: unknown): Promise<void> {
    return writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function isTailscaleOwner(request: IncomingMessage): boolean {
    const login = String(request.headers['tailscale-user-login'] ?? '').trim().toLowerCase();

    return !!login && ALLOWED_LOGINS.includes(login);
}

async function addHistory(entry: Omit<HistoryEntry, 'id' | 'at'>): Promise<void> {
    const history = await readFileJson<HistoryEntry[]>(HISTORY_PATH, []);

    history.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), ...entry });

    await writeFileJson(HISTORY_PATH, history.slice(0, HISTORY_LIMIT));
}

interface Recipient {
    name: string;
    email: string;
}

function readRecipients(): Promise<Recipient[]> {
    return readFileJson<Recipient[]>(RECIPIENTS_PATH, []);
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
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

        const viaTailscale = isTailscaleOwner(request);

        if (!config || (!viaTailscale && request.headers.authorization !== `Bearer ${config.importApiKey}`)) {
            return send(response, 401, { ok: false, error: 'UNAUTHORIZED', message: 'API-Key fehlt oder ist falsch.' });
        }

        if (request.method === 'GET' && request.url === '/config/status') {
            return send(response, 200, { ok: true, configured: true, webId: config.webId, cookbookUrl: config.cookbookUrl });
        }

        if (request.method === 'GET' && request.url === '/state') {
            const settings = await readFileJson<{ template?: string }>(SETTINGS_PATH, {});

            return send(response, 200, {
                ok: true,
                auth: viaTailscale ? 'tailscale' : 'key',
                recipients: await readRecipients(),
                template: settings.template ?? config.shareMessageTemplate ?? null,
                history: await readFileJson<HistoryEntry[]>(HISTORY_PATH, []),
            });
        }

        if (request.method === 'PUT' && request.url === '/settings') {
            const { template } = await readJson(request);

            await writeFileJson(SETTINGS_PATH, { template: String(template ?? '') });

            return send(response, 200, { ok: true });
        }

        if (request.method === 'DELETE' && request.url?.startsWith('/history/')) {
            const id = decodeURIComponent(request.url.slice('/history/'.length));
            const history = await readFileJson<HistoryEntry[]>(HISTORY_PATH, []);

            await writeFileJson(HISTORY_PATH, history.filter(entry => entry.id !== id));

            return send(response, 200, { ok: true });
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
            const recipeUrl = String(url ?? '');
            let result;

            try {
                result = await importRecipe(config, recipeUrl);
            } catch (error) {
                if (error instanceof ImportError) {
                    await addHistory({ url: recipeUrl, ok: false, error: error.code, message: error.message });
                }

                throw error;
            }

            const payload = {
                recipeName: result.name,
                recipeUrl: result.url,
                shared: result.shared,
                viewerUrl: `${VIEWER_BASE_URL}/viewer?url=${encodeURIComponent(result.documentUrl)}`,
            };

            await addHistory({ url: recipeUrl, ok: true, ...payload });

            return send(response, 200, { ok: true, ...payload });
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
