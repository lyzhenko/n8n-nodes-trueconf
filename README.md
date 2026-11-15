# n8n-nodes-trueconf

**English** · [Русский](README.ru.md)

[n8n](https://n8n.io) community node for **TrueConf Server** — a chatbot integration built on the
TrueConf Chatbot Connector (HTTP API + WebSocket). Think of the Telegram node: the bot receives
messages in real time and answers with text or files.

```
n8n workflow:  [TrueConf Trigger] ──► [any n8n logic] ──► [TrueConf: Send Message]
```

## Features

**`TrueConf` node (action)**

| Resource | Operations |
|---|---|
| Message | Send Message, Send File, Edit Message, Delete Message, Forward Message, Get Message, Get Chat History |
| Chat | Get Many, Get, Create Personal Chat, Create Group Chat, Create Channel, Get Participants |
| Bot | Get Bot Info (connection check + bot TrueConf ID) |

**`TrueConf Trigger` node** — starts a workflow on TrueConf events: new message, inline button press,
chat created, participants changed, message edited/removed, chat updated. Filter by event type and by
chat ID, ignore the bot's own messages, and optionally deliver messages received while the workflow
was inactive.

**`TrueConf API` credential** — server URL, bot TrueConf ID and password. The JWT is cached for a
month; the **Test** button validates the credentials against the real server.

## Requirements

* n8n **2.x** (tested on 2.47.7), Node.js >= 24 (an n8n 2.x requirement).
* TrueConf Server **5.5.0+** (TrueConf Server Free works: the Chatbot Connector is part of the free
  edition). The bot is a regular TrueConf user account with a password.
* Network access from n8n to the TrueConf Bridge: `http://<server>:4309` (local) or
  `https://<server>` through TrueConf Web Manager.

Server and bot preparation: [docs/trueconf-prerequisites.md](docs/trueconf-prerequisites.md).

## Installation

### From npm (recommended)

1. n8n → **Settings → Community nodes → Install**.
2. Enter `n8n-nodes-trueconf` and confirm.
3. On self-hosted instances the package must be allowed:
   `N8N_UNVERIFIED_PACKAGES_ENABLED=true`.

### Manual installation (tarball)

```bash
npm install
npm run build
npm pack                       # -> n8n-nodes-trueconf-0.1.0.tgz

# on the n8n host (root)
install -d -o n8n -g n8n -m 0750 /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf
tar -xzf n8n-nodes-trueconf-0.1.0.tgz \
    -C /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf --strip-components=1
chown -R n8n:n8n /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf

systemctl restart n8n
```

`/var/lib/n8n` is the `N8N_USER_FOLDER` of this deployment; adjust it for your setup
(`~/.n8n` for a default npm installation, a mounted volume for Docker). The package ships the only
runtime dependency (`ws`) bundled, so `npm install` on the server is not needed.

More details: [docs/installation.md](docs/installation.md).

## Configuration

1. **Credentials → New → TrueConf API**
   * **Server URL** — `http://trueconf.example.com:4309` (local Bridge) or
     `https://trueconf.example.com`. The scheme is optional and defaults to `http`.
   * **Bot TrueConf ID** — for example `bot@example.trueconf.name`.
   * **Bot Password** — the bot account password.
   * **Ignore SSL Issues** — enable for a self-signed TrueConf certificate.
2. Press **Test** — you should see `Connection successful!`.

## Usage

### Send a message

1. Add the **TrueConf** node, resource `Message`, operation `Send Message`.
2. **Chat ID or TrueConf ID** accepts either a chat id (for example from the trigger node) or a
   TrueConf ID (`user@example.trueconf.name`) — in the latter case the bot opens (or reuses) a
   personal chat.
3. Fill in the text, the parse mode (`text` / `markdown` / `html`) and optionally `Reply to Message ID`.

### Send a file

`Send File` takes the file from an input binary field (default `data`). Typical chain:
`HTTP Request` (Response Format = File) → `TrueConf: Send File`, or `Read Binary File`.

### Reply to an incoming message

`TrueConf Trigger` (event **Message Received**) → your logic → `TrueConf: Send Message` with
**Chat ID or TrueConf ID** = `{{ $json.chatId }}` and **Reply to Message ID** = `{{ $json.messageId }}`.

The trigger exposes convenient fields: `chatId`, `chatTitle`, `chatType`, `messageId`, `authorId`,
`authorType`, `text`, `parseMode`, `contentType`, `timestamp`, `replyMessageId`, file fields for
attachments, and the original TrueConf object in `raw`.

Ready-to-import workflows: [examples/](examples/).

## Development

```bash
npm install
npm run build        # tsc + icon copy into dist/
npm test             # protocol unit tests against a mock TrueConf Bridge (14 checks)
npm run typecheck
```

End-to-end tests: `tests/mock-bridge.mjs` implements the protocol, `tests/client.test.mjs` covers
auth, framing, acknowledgements, reconnects and file uploads.

See [docs/testing.md](docs/testing.md) for the live-server test procedure and
[docs/architecture.md](docs/architecture.md) for the design decisions.

## Repository layout

```
src/
  credentials/TrueConfApi.credentials.ts   # credential + Test button
  nodes/TrueConf/
    BridgeClient.ts                        # WebSocket client: auth, ids, ack, reconnect, JWT cache
    GenericFunctions.ts                    # multipart upload, Envelope formatting
    TrueConf.node.ts                       # action node
    TrueConfTrigger.node.ts                # trigger node
    descriptions/                          # UI parameters per resource
tests/                                     # unit tests and the mock TrueConf Bridge
examples/                                  # importable workflow JSON
docs/                                      # installation, architecture, testing, research
```

## Limitations

* **One WebSocket session per bot.** All workflow runs share a single client (TrueConf allows 128
  connections per server). The trigger opens its own connection so that a failed action call cannot
  break event delivery.
* **Push-only protocol.** TrueConf delivers events over WebSocket; there is no webhook mode, so the
  trigger keeps a persistent connection and reconnects with backoff.
* **Acknowledgements.** Every server notification is acknowledged automatically — otherwise TrueConf
  closes the session after 300 seconds.
* **Formatting.** `text`, `markdown` and `html` are supported; inline buttons (TrueConf 5.5.6+) are
  not exposed in the UI yet.
* **Chatbot Connector only.** Server administration (users, conferences) uses a different API
  (TrueConf Server API v4 with OAuth2) and is not part of this node.

## Documentation

* [Installation and upgrade](docs/installation.md)
* [Architecture and design decisions](docs/architecture.md)
* [Testing](docs/testing.md)
* [TrueConf Server and bot prerequisites](docs/trueconf-prerequisites.md)
* [Chatbot Connector API research](docs/research/chatbot-connector.md) (contract, 34 methods, events, errors)

Official documentation: [TrueConf Chatbot Connector](https://trueconf.ru/docs/chatbot-connector/ru/overview/),
[TrueConf Server](https://trueconf.ru/docs/main/ru/).

## License

[MIT](LICENSE)

---

Русская версия: [README.ru.md](README.ru.md)
