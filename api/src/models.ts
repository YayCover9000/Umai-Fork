import { bootModels } from 'soukai';
import { bootSolidModels } from 'soukai-solid';
import type { Relation } from 'soukai';
import type { SolidBelongsToManyRelation } from 'soukai-solid';

import RecipeSchema from '@/models/Recipe.schema';
import RecipeInstructionsStepSchema from '@/models/RecipeInstructionsStep.schema';

// Server-side counterparts of src/models/Recipe.ts and RecipeInstructionsStep.ts. Those import Vue services, so only
// the schemas (which define the stored shape) are shared.
export class RecipeInstructionsStep extends RecipeInstructionsStepSchema {}

export class Recipe extends RecipeSchema {

    declare public instructions?: RecipeInstructionsStep[];
    declare public relatedInstructions: SolidBelongsToManyRelation<
        this,
        RecipeInstructionsStep,
        typeof RecipeInstructionsStep
    >;

    public instructionsRelationship(): Relation {
        return this
            .belongsToMany(RecipeInstructionsStep, 'instructionStepUrls')
            .onDelete('cascade')
            .usingSameDocument(true);
    }

}

export function bootRecipeModels(): void {
    bootSolidModels();
    bootModels({ Recipe, RecipeInstructionsStep });

    // Same aliasing as CookbookService, so http:// and https:// schema.org data is read alike.
    for (const modelClass of [Recipe, RecipeInstructionsStep]) {
        modelClass.aliasRdfPrefixes({ 'https://schema.org/': 'http://schema.org/' });
    }
}
