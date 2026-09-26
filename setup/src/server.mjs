import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClientCredentials, discoverCookbook } from './solid-setup.mjs';

const DATA_DIR = process.env.DATA_DIR ?? '/data';
const CONFIG_PATH = join(DATA_DIR, 'config.json');
const PORT = Number(process.env.PORT ?? 8080);
const DEFAULT_POD = process.env.DEFAULT_POD_URL ?? 'https://umairecepie.solidcommunity.net/';
const ISSUER = process.env.OIDC_ISSUER ?? 'https://solidcommunity.net';
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');

async function readConfig() {
    try {
        return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    } catch {
        return null;
    }
}

function publicStatus(config) {
    return config
        ? { configured: true, webId: config.webId, podUrl: config.podUrl, cookbookUrl: config.cookbookUrl }
        : { configured: false, defaultPodUrl: DEFAULT_POD };
}

async function body(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

function send(response, status, payload, type = 'application/json') {
    response.writeHead(status, { 'content-type': type });
    response.end(type === 'application/json' ? JSON.stringify(payload) : payload);
}

async function save({ email, password, podUrl, tokenName, shareMessageTemplate }) {
    if (!email || !password) throw new Error('E-Mail und Passwort sind erforderlich.');

    const pod = new URL(podUrl ?? DEFAULT_POD);
    const webId = `${pod.origin}/profile/card#me`;
    const existing = await readConfig();
    const credentials = await createClientCredentials({
        issuer: ISSUER,
        email,
        password,
        webId,
        tokenName: tokenName || 'umai-nas-import',
    });
    const cookbookUrl = await discoverCookbook({ issuer: ISSUER, webId, ...credentials }).catch(error => {
        if (error.message === 'NO_COOKBOOK' || error.message === 'NO_TYPE_INDEX') {
            throw new Error('Cookbook nicht gefunden - bitte einmal in der Umai-Webapp öffnen und Sync auslösen.');
        }
        throw error;
    });

    const config = {
        oidcIssuer: ISSUER,
        webId,
        podUrl: `${pod.origin}/`,
        cookbookUrl,
        ...credentials,
        importApiKey: existing?.importApiKey ?? randomUUID(),
        shareMessageTemplate: shareMessageTemplate || 'Hi! Schau dir dieses Rezept an: {name}\n{link}',
        setupCompletedAt: new Date().toISOString(),
    };

    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
    await chmod(CONFIG_PATH, 0o600);

    return { ...publicStatus(config), importApiKey: config.importApiKey };
}

createServer(async (request, response) => {
    try {
        if (request.method === 'GET' && request.url === '/api/status') {
            return send(response, 200, publicStatus(await readConfig()));
        }

        if (request.method === 'POST' && request.url === '/api/setup') {
            const existing = await readConfig();
            const payload = await body(request);
            if (existing && payload.currentApiKey !== existing.importApiKey) {
                return send(response, 403, { ok: false, message: 'Bereits eingerichtet - zum Ändern den API-Key angeben.' });
            }

            return send(response, 200, { ok: true, ...(await save(payload)) });
        }

        if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
            return send(response, 200, await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
        }

        send(response, 404, { ok: false, message: 'Not found' });
    } catch (error) {
        send(response, 500, { ok: false, message: error.message });
    }
}).listen(PORT, () => console.log(`umai-setup listening on ${PORT}`));
