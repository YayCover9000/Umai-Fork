<template>
    <form class="p-4" @submit.prevent="submit()">
        <p class="font-medium text-gray-900">{{ $t('settings.nasImport') }}</p>
        <CoreMarkdown :text="$t('settings.nasImport_description')" class="text-sm text-gray-500" />
        <label class="flex flex-col mt-2 text-sm font-medium text-gray-700">
            {{ $t('settings.nasImport_apiUrl') }}
            <input v-model="apiUrl" class="mt-1 p-2 border border-gray-300 rounded font-normal" @change="persist()">
        </label>
        <label class="flex flex-col mt-2 text-sm font-medium text-gray-700">
            {{ $t('settings.nasImport_apiKey') }}
            <input
                v-model="apiKey"
                type="password"
                autocomplete="off"
                class="mt-1 p-2 border border-gray-300 rounded font-normal"
                @change="persist()"
            >
        </label>
        <label class="flex flex-col mt-2 text-sm font-medium text-gray-700">
            {{ $t('settings.nasImport_recipeUrl') }}
            <input v-model="recipeUrl" type="url" class="mt-1 p-2 border border-gray-300 rounded font-normal">
        </label>
        <CoreButton class="mt-3" type="submit" :disabled="loading || !apiUrl || !apiKey || !recipeUrl">
            {{ $t('settings.nasImport_submit') }}
        </CoreButton>
        <p v-if="message" :class="failed ? 'text-red-500' : 'text-green-700'" class="mt-2 text-sm">{{ message }}</p>
    </form>
</template>

<script setup lang="ts">
import App from '@/framework/core/facades/App';
import { translate } from '@/framework/utils/translate';

const STORAGE_KEY = 'umai-nas-import';

function loadSettings(): { apiUrl?: string; apiKey?: string } {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
        return {};
    }
}

const saved = loadSettings();
let apiUrl = $ref(saved.apiUrl ?? App.env<string | undefined>('IMPORT_API_URL') ?? '');
let apiKey = $ref(saved.apiKey ?? '');
let recipeUrl = $ref('');
let loading = $ref(false);
let failed = $ref(false);
let message = $ref('');

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiUrl, apiKey }));
    } catch {
        // Storage unavailable, settings just won't persist.
    }
}

async function submit() {
    loading = true;
    failed = false;
    message = '';

    try {
        const response = await fetch(`${apiUrl.replace(/\/$/, '')}/import`, {
            method: 'POST',
            headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ url: recipeUrl }),
        });
        const result = await response.json();

        failed = !result.ok;
        message = result.ok
            ? translate('settings.nasImport_success', { name: result.recipeName })
            : result.message ?? translate('settings.nasImport_error');

        if (result.ok) {
            recipeUrl = '';
        }
    } catch {
        failed = true;
        message = translate('settings.nasImport_error');
    } finally {
        loading = false;
    }
}
</script>
