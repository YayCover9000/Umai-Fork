import { arr, arrayFilter, isArray, isObject, silenced, stringMatchAll, tap } from '@noeldemartin/utils';
import { isJsonLDGraph } from '@noeldemartin/solid-utils';
import type { JsonLD, JsonLDResource } from '@noeldemartin/solid-utils';

import { Recipe } from './models';

// Port of src/utils/web-parsing.ts without browser APIs (DOM entity decoding is done by hand).
const CONTEXT_ALIASES: Record<string, string> = {
    'http://schema.org': 'https://schema.org/',
    'http://schema.org/': 'https://schema.org/',
    'https://schema.org': 'https://schema.org/',
};
const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°', frac12: '½', frac14: '¼', frac34: '¾',
};

interface RecipeJsonLD extends JsonLD {
    cookTime?: string;
    prepTime?: string;
    totalTime?: string;
    recipeInstructions?: string | string[] | JsonLD | JsonLD[];
    recipeIngredient?: string | string[];
    image?: string | string[] | { url?: string } | { url?: string }[];
}

function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (match, entity: string) => {
        if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
        if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));

        return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    });
}

function cleanEntities<T>(obj: T, property: keyof T): void {
    if (typeof obj[property] === 'string') {
        obj[property] = decodeEntities(obj[property] as unknown as string) as unknown as T[keyof T];
    }
}

function reshapeContexts(json: JsonLD): void {
    for (const [property, value] of Object.entries(json)) {
        if (property === '@context' && typeof value === 'string') {
            json['@context'] = { '@vocab': CONTEXT_ALIASES[value] ?? value };

            continue;
        }

        if (isObject(value)) reshapeContexts(value);
    }
}

function parseInstructions(instructions: string): JsonLD | JsonLD[] {
    const steps = arr(instructions.matchAll(/<li[^>]*?>([\S\s]*?)<\/li>/gim)).map(([, step]) => step).toArray();
    const step = (text: string, position: number) => ({
        '@context': { '@vocab': 'https://schema.org/' },
        '@type': 'HowToStep',
        text,
        position,
    });

    return steps.length > 0 ? steps.map((text, index) => step(text, index + 1)) : step(instructions, 1);
}

function reshapeImage(json: RecipeJsonLD): void {
    if (typeof json.image === 'string' && json.image.startsWith('http:http')) {
        json.image = json.image.slice(5);

        return;
    }

    if (Array.isArray(json.image)) {
        json.image = json.image[0];
        reshapeImage(json);

        return;
    }

    if (typeof json.image === 'object') json.image = json.image.url;
}

function reshapeRecipe(json: RecipeJsonLD): void {
    reshapeContexts(json);

    if (!json.cookTime && !json.prepTime && json.totalTime) json.cookTime = json.totalTime;

    if (typeof json.recipeInstructions === 'string') {
        json.recipeInstructions = parseInstructions(json.recipeInstructions);
    } else if (Array.isArray(json.recipeInstructions)) {
        json.recipeInstructions = json.recipeInstructions.map((instruction, index) => typeof instruction === 'object'
            ? { position: index + 1, ...instruction }
            : {
                '@context': { '@vocab': 'https://schema.org/' },
                '@type': 'HowToStep',
                'text': instruction,
                'position': index + 1,
            });
    }

    if (json.recipeIngredient) json.recipeIngredient = [json.recipeIngredient].flat().map(i => i.trim());

    reshapeImage(json);
    cleanEntities(json, 'name');
    cleanEntities(json, 'description');

    if (isArray(json.recipeIngredient)) json.recipeIngredient.forEach((_, i) => cleanEntities(json.recipeIngredient as string[], i));
    if (isArray(json.recipeInstructions)) {
        json.recipeInstructions.forEach(step => isObject(step) && cleanEntities(step, 'text'));
    }
}

function extractJsonLDResources(html: string): JsonLDResource[] {
    const blocks = stringMatchAll<2>(html, /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gim);

    return arr(blocks)
        .map(([, rawJson]) => {
            try {
                return JSON.parse(rawJson);
            } catch {
                return [];
            }
        })
        .flat()
        .map(json => {
            if (!isObject(json)) return [];

            if (isJsonLDGraph(json)) {
                return json['@graph'].map(resource => tap(resource, () => {
                    resource['@context'] = json['@context'];
                }));
            }

            return [json];
        })
        .flat()
        .filter(resource => !!resource) as unknown as JsonLDResource[];
}

export async function parseWebsiteRecipes(url: string, html: string): Promise<Recipe[]> {
    const recipes = await Promise.all(extractJsonLDResources(html).map(jsonld => {
        reshapeRecipe(jsonld as RecipeJsonLD);

        return silenced(Recipe.newFromJsonLD(jsonld));
    }));

    return arrayFilter(recipes).map(recipe => tap(recipe, () => recipe.setAttribute('externalUrls', [url])));
}
