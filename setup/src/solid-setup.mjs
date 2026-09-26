import { Session } from '@inrupt/solid-client-authn-node';
import { Parser } from 'n3';

const SOLID = 'http://www.w3.org/ns/solid/terms#';
const SCHEMA_RECIPE = ['https://schema.org/Recipe', 'http://schema.org/Recipe'];

async function json(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status} from ${response.url}`);
    return body;
}

/** Logs in through the CSS account API and creates a client-credentials token for the given WebID. */
export async function createClientCredentials({ issuer, email, password, webId, tokenName }) {
    const base = `${issuer.replace(/\/$/, '')}/.account/`;
    const controls = (await json(await fetch(base))).controls;
    const { authorization } = await json(
        await fetch(controls.password.login, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
        }),
    );
    const headers = { authorization: `CSS-Account-Token ${authorization}`, 'content-type': 'application/json' };
    const account = (await json(await fetch(base, { headers }))).controls;
    const { id, secret } = await json(
        await fetch(account.account.clientCredentials, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: tokenName, webId }),
        }),
    );

    return { clientId: id, clientSecret: secret };
}

async function parseQuads(fetchFn, url) {
    const response = await fetchFn(url, { headers: { accept: 'text/turtle' } });
    if (!response.ok) throw new Error(`Could not read ${url} (HTTP ${response.status})`);
    return new Parser({ baseIRI: url }).parse(await response.text());
}

/** Finds the recipes container through the private type index, like Umai does. Never guesses a path. */
export async function discoverCookbook({ issuer, clientId, clientSecret, webId }) {
    const session = new Session();
    await session.login({ oidcIssuer: issuer, clientId, clientSecret, tokenType: 'DPoP' });
    if (!session.info.isLoggedIn) throw new Error('Login with client credentials failed.');

    try {
        const profile = await parseQuads(session.fetch, webId.split('#')[0]);
        const typeIndexUrl = profile.find(q => q.predicate.value === `${SOLID}privateTypeIndex`)?.object.value;
        if (!typeIndexUrl) throw new Error('NO_TYPE_INDEX');

        const index = await parseQuads(session.fetch, typeIndexUrl);
        const registrations = index
            .filter(q => q.predicate.value === `${SOLID}forClass` && SCHEMA_RECIPE.includes(q.object.value))
            .map(q => q.subject.value);
        const container = index.find(
            q => registrations.includes(q.subject.value) && q.predicate.value === `${SOLID}instanceContainer`,
        )?.object.value;
        if (!container) throw new Error('NO_COOKBOOK');

        return container;
    } finally {
        await session.logout().catch(() => {});
    }
}
