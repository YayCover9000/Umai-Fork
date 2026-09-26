# umai-nas

Self-hosted Umai with a setup GUI, an import API and email/WhatsApp sharing. Upstream: https://github.com/NoelDeMartin/umai (GPL-3.0, so this fork stays open source).

## Services (docker-compose.yml)

| Service | Port | Purpose |
|---------|------|---------|
| `setup` | 8080 | One-time connection to your SolidCommunity Pod: e-mail + password are used once to create a client-credentials token and to find the cookbook through the private type index. The password is never stored. |
| `api`   | 8787 | `POST /import` (recipe url -> Pod), `GET /config/status`, `GET /health`. Requires `Authorization: Bearer <importApiKey>`. |
| `web`   | 3000 | The Umai web app (build args set the default issuer and Pod). |

Shared volume `umai-data` holds `/data/config.json` (client secret, API key). Keep it private.

## Start

```bash
cp .env.example .env   # set VITE_IMPORT_API_URL and VIEWER_BASE_URL to the NAS address
docker compose up -d --build
```

1. Open `http://<nas>:8080`, enter the SolidCommunity e-mail and password, keep the pod `https://umairecepie.solidcommunity.net/`. Note the import API key shown afterwards.
2. If the setup reports that the cookbook was not found, open the web app once, log in and let it sync, then repeat.
3. Web app: Settings -> "Import via NAS API" takes the API url, the key and a recipe url.

## Import page (Tailscale)

`http://<nas>:8787/` serves a page where you paste recipe urls (one per line), import them and share each one by e-mail to saved recipients (stored in `/data/recipients.json`). Imported recipes are made readable through their link (Umai's "Unlisted" profile); the message links to the public Umai viewer, so recipients do not need Tailscale. The first time, enter the import API key on the page.

Keep it private to the tailnet:

```bash
echo "BIND_ADDR=$(tailscale ip -4)" >> .env      # ports listen only on the Tailscale address
tailscale serve --bg --https=443 http://127.0.0.1:8787   # HTTPS at https://<nas>.<tailnet>.ts.net
```

Do not use `tailscale funnel`, it would expose the page to the internet. With `BIND_ADDR` set to the Tailscale address, `tailscale serve` should target that address instead of 127.0.0.1.

## Import from other tools

```bash
curl -X POST http://<nas>:8787/import \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/some-recipe"}'
```

The same request works from an iOS Shortcut ("Get contents of URL", POST, JSON body) or Tasker. Pages need a schema.org `Recipe` in JSON-LD, otherwise the API answers `NO_JSON_LD`.

## Sharing

Recipe -> Share -> "Recipes viewer": edit the message (`{name}`, `{description}`, `{link}`), then send by e-mail or WhatsApp. The recipe must be Public or Unlisted, otherwise the recipient gets a 401.

## Known limits

- The API does not load remote JSON-LD contexts (see `api/src/stubs/http-client.ts`).
- `api/src/parsing.ts` is a DOM-free copy of `src/utils/web-parsing.ts`; keep them in step when updating from upstream.
- No rate limiting or proxy for sites that block server requests.
- Use HTTPS (reverse proxy) before exposing anything outside the LAN. The API answers with `Access-Control-Allow-Origin: *`; the API key is the only protection.
