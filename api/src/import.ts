import { Session } from '@inrupt/solid-client-authn-node';
import { SolidDocumentPermission } from '@noeldemartin/solid-utils';
import { setEngine } from 'soukai';
import { SolidEngine } from 'soukai-solid';

import { Recipe, bootRecipeModels } from './models';
import { parseWebsiteRecipes } from './parsing';

export interface ImportConfig {
    oidcIssuer: string;
    clientId: string;
    clientSecret: string;
    cookbookUrl: string;
}

export class ImportError extends Error {

    constructor(public code: string, message: string, public status = 400) {
        super(message);
    }

}

let booted = false;

function bootModels(): void {
    if (booted) return;

    bootRecipeModels();
    // newFromJsonLD needs an engine to be set, but parsing never touches the network: use a plain one until login.
    setEngine(new SolidEngine(globalThis.fetch));
    booted = true;
}

async function openSession(config: ImportConfig): Promise<Session> {
    const session = new Session();

    await session.login({
        oidcIssuer: config.oidcIssuer,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tokenType: 'DPoP',
    });

    if (!session.info.isLoggedIn) {
        throw new ImportError('POD_LOGIN_FAILED', 'Anmeldung am Pod fehlgeschlagen.', 502);
    }

    return session;
}

function looksBlocked(status: number, html: string): boolean {
    return [202, 403, 429, 503].includes(status)
        || /sgcaptcha|cf-chl|cf-browser-verification|captcha/i.test(html.slice(0, 5000))
        || (html.length < 1000 && /http-equiv=["']refresh["']/i.test(html));
}

async function fetchHtml(url: string): Promise<string> {
    let response: Response;

    try {
        response = await fetch(url, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (umai-nas)' } });
    } catch {
        throw new ImportError('FETCH_FAILED', 'Die Seite konnte nicht geladen werden.', 502);
    }

    const html = await response.text();

    if (looksBlocked(response.status, html)) {
        throw new ImportError('BLOCKED_BY_SITE', 'Die Seite blockiert Server-Abrufe (Bot-Schutz).', 422);
    }

    if (!response.ok) {
        throw new ImportError('FETCH_FAILED', `Die Seite antwortete mit HTTP ${response.status}.`, 502);
    }

    return html;
}

export async function importRecipe(config: ImportConfig, url: string) {
    if (!/^https?:\/\//.test(url)) {
        throw new ImportError('INVALID_URL', 'Ungültige URL.');
    }

    bootModels();

    const recipes = await parseWebsiteRecipes(url, await fetchHtml(url));
    const recipe = recipes[0];

    if (!recipe) {
        throw new ImportError('NO_JSON_LD', 'Kein schema.org/Recipe auf der Seite gefunden.', 422);
    }

    const session = await openSession(config);

    try {
        setEngine(new SolidEngine(session.fetch));
        Recipe.collection = config.cookbookUrl;

        await recipe.save();

        let shared = true;

        try {
            // Same permissions as Umai's "Unlisted" profile: readable through the link, not listed publicly.
            await recipe.updatePublicPermissions([SolidDocumentPermission.Read]);
        } catch {
            shared = false;
        }

        return { name: recipe.name, url: recipe.url, documentUrl: recipe.getDocumentUrl(), shared };
    } finally {
        await session.logout().catch(() => {});
    }
}
