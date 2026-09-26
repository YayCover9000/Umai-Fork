// jsonld's Node document loader depends on @digitalbazaar/http-client, which uses the `esm` package and crashes on
// modern Node. Umai only uses inline JSON-LD contexts, so remote context loading is deliberately unsupported.
export const httpClient = {
    get(): never {
        throw new Error('Loading remote JSON-LD documents is not supported.');
    },
};

export default { httpClient };
