export interface ShareMessageVars {
    name: string;
    description?: string;
    link: string;
}

export const DEFAULT_SHARE_MESSAGE_TEMPLATE = 'Hi! Check out this recipe: {name}\n{link}';

const TEMPLATE_STORAGE_KEY = 'umai-share-message-template';

export function renderShareMessage(template: string, vars: ShareMessageVars): string {
    return template
        .replace(/\{name\}/g, vars.name)
        .replace(/\{description\}/g, vars.description ?? '')
        .replace(/\{link\}/g, vars.link);
}

export function loadShareMessageTemplate(): string {
    try {
        return localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? DEFAULT_SHARE_MESSAGE_TEMPLATE;
    } catch {
        return DEFAULT_SHARE_MESSAGE_TEMPLATE;
    }
}

export function saveShareMessageTemplate(template: string): void {
    try {
        localStorage.setItem(TEMPLATE_STORAGE_KEY, template);
    } catch {
        // Storage unavailable, the template just won't persist.
    }
}

export function mailtoUrl(subject: string, body: string): string {
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function whatsappUrl(message: string): string {
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
