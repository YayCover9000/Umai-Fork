<template>
    <AppModal>
        <template #title>
            <div class="flex justify-between">
                {{ $t('recipes.share') }}
                <RecipeAccessControl v-if="requiresPermissions" :recipe="recipe" />
            </div>
        </template>

        <template #default="{ close }">
            <RecipeShareOptions v-model="shareOption" />
            <CoreClipboard v-if="clipboardContent" class="mt-4 max-w-prose" :text="clipboardContent" />
            <div v-if="shareOption === 'umai'" class="mt-4 max-w-prose w-full">
                <label class="block mb-1" for="share-message">{{ $t('recipes.shareMessage') }}</label>
                <textarea
                    id="share-message"
                    v-model="messageTemplate"
                    rows="4"
                    class="w-full border border-gray-300 rounded p-2"
                    @change="saveShareMessageTemplate(messageTemplate)"
                />
                <p class="text-sm text-gray-600 mt-1">{{ $t('recipes.shareMessage_help') }}</p>
                <div class="flex gap-x-2 mt-2">
                    <a :href="mailHref" class="underline">{{ $t('recipes.shareEmail') }}</a>
                    <a :href="whatsappHref" target="_blank" rel="noopener" class="underline">
                        {{ $t('recipes.shareWhatsApp') }}
                    </a>
                </div>
            </div>
            <p v-if="warning" class="text-red-500 flex self-start mt-2 max-w-prose">
                <i-zondicons-exclamation-outline class="w-4 h-4 mt-1 mr-2 flex-shrink-0" />
                {{ warning }}
            </p>
            <CoreMarkdown v-else-if="shareOption === 'print'" class="mt-4" :text="$t('recipes.print_info')" />
            <div class="flex flex-col justify-between items-end mt-4 gap-y-2 md:flex-row md:gap-x-2 md:gap-y-0">
                <label v-if="shareOption === 'jsonld'" class="cursor-pointer flex items-center self-start mb-4 md:mb-0">
                    <CoreToggle v-model="includeHistory" />
                    <p class="ml-2">{{ $t('recipes.download_includeHistory') }}</p>
                </label>
                <span v-else />
                <CoreButton
                    v-if="shareOption === 'jsonld'"
                    @click="() => (recipe.download({ includeHistory }), close())"
                >
                    <i-pepicons-cloud-down class="w-6 h-6" aria-hidden="true" />
                    <span class="ml-2">{{ $t('recipes.download') }}</span>
                </CoreButton>
                <CoreButton
                    v-if="shareOption === 'print' && $browser.supportsPrinting"
                    @click="close().then(() => print())"
                >
                    <i-pepicons-file class="w-6 h-6" aria-hidden="true" />
                    <span class="ml-2">{{ $t('recipes.print') }}</span>
                </CoreButton>
                <CoreButton
                    v-else-if="shareOption !== 'print' && $browser.supportsSharing"
                    @click="close(), share()"
                >
                    <i-pepicons-share-android class="w-6 h-6" aria-hidden="true" />
                    <span class="ml-2">{{ $t('recipes.share') }}</span>
                </CoreButton>
            </div>
        </template>
    </AppModal>
</template>

<script setup lang="ts">
import { after, objectWithoutEmpty, stringExcerpt, urlRoot } from '@noeldemartin/utils';

import Browser from '@/framework/core/facades/Browser';
import Errors from '@/framework/core/facades/Errors';
import Router from '@/framework/core/facades/Router';
import { requiredObjectProp } from '@/framework/utils/vue';
import { translate } from '@/framework/utils/translate';

import Cookbook from '@/services/facades/Cookbook';
import {
    loadShareMessageTemplate,
    mailtoUrl,
    renderShareMessage,
    saveShareMessageTemplate,
    whatsappUrl,
} from '@/utils/shareMessage';
import { RecipeShareOption } from '@/components/recipe/RecipeShareOptions';
import type Recipe from '@/models/Recipe';

const { recipe } = defineProps({
    recipe: requiredObjectProp<Recipe>(),
});

const includeHistory = $ref(false);
const shareOption = $ref<RecipeShareOption>(Cookbook.isRemote ? RecipeShareOption.Umai : RecipeShareOption.JsonLD);
const clipboardContents: Record<RecipeShareOption, string | null> = $computed(() => ({
    [RecipeShareOption.Umai]:
        urlRoot(location.href) +
        Router.resolve({ name: 'viewer', query: { url: recipe.getDocumentUrl() } }).href,
    [RecipeShareOption.Solid]: recipe.url,
    [RecipeShareOption.JsonLD]: JSON.stringify(recipe.toExternalJsonLD({ includeHistory }), null, 2),
    [RecipeShareOption.Print]: null,
}));
const messageTemplate = $ref(loadShareMessageTemplate());
const shareMessage = $computed(() =>
    renderShareMessage(messageTemplate, {
        name: recipe.name,
        description: recipe.description ?? undefined,
        link: clipboardContents[RecipeShareOption.Umai] as string,
    }));
const mailHref = $computed(() => mailtoUrl(recipe.name, shareMessage));
const whatsappHref = $computed(() => whatsappUrl(shareMessage));
const clipboardContent = $computed(() => clipboardContents[shareOption as RecipeShareOption & PropertyKey]);
const requiresPermissions = $computed(() => {
    if (!Cookbook.isRemote) {
        return false;
    }

    return shareOption === RecipeShareOption.Umai || shareOption === RecipeShareOption.Solid;
});
const warning = $computed(() => {
    if (shareOption === RecipeShareOption.Print && !Browser.supportsPrinting) {
        return translate('recipes.print_unsupportedBrowser');
    }

    if (!requiresPermissions || recipe.isPrivate === false) {
        return;
    }

    return recipe.isPrivate
        ? translate('recipes.accessControl.warning_private')
        : translate('recipes.accessControl.warning_unknown');
});

function share() {
    const removeHandler = Errors.handleErrors(error => error instanceof Error && error.name === 'AbortError');

    navigator.share(objectWithoutEmpty({
        title: recipe.name,
        text: recipe.description ? stringExcerpt(recipe.description) : null,
        url: clipboardContent,
    }));

    after({ seconds: 60 }).then(() => removeHandler());
}

function print() {
    window.print();
}
</script>
