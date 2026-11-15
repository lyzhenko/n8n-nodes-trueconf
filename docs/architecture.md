# Архитектура и принятые решения

## Схема

```
┌──────────────────────────── n8n (один процесс, Node.js) ────────────────────────────┐
│                                                                                     │
│  workflow A: [TrueConf: Send Message] ───┐                                          │
│  workflow B: [TrueConf Trigger] ────┐    │        ┌──────────────────────────────┐  │
│                                     │    ├───────►│ BridgeClient (общий на бота)  │  │
│                                     │    │        │ • JWT-кеш на месяц           │  │
│                                     │    │        │ • id-счётчик, pending-map     │  │
│                                     │    │        │ • авто-ack событий           │  │
│                                     └────┼───────►│ • реконнект с backoff         │  │
│                                          │        └──────────────┬───────────────┘  │
│  workflow B: TrueConf Trigger ───────────┘                       │                  │
│  (отдельный BridgeClient, чтобы разрыв action-вызовов               │ ws://…:4309     │
│   не останавливал приём событий)                                    │                 │
└─────────────────────────────────────────────────────────────────────┼─────────────────┘
                                                                      ▼
                                              TrueConf Bridge (trueconf-bridge)
                                                   /bridge/api/client/v1/oauth/token
                                                   /bridge/api/client/v1/files
                                                   /websocket/chat_bot/
```

## Протокол Chatbot Connector (кратко)

1. **HTTP**: `POST /bridge/api/client/v1/oauth/token` с `client_id=chat_bot`, `grant_type=password`,
   логином и паролем бота → `201 {access_token, token_type:"JWT", expires_at}`. Токен живёт месяц.
2. **WebSocket**: `ws(s)://<host>/websocket/chat_bot/`, подпротокол `json.v1`. Первый кадр —
   `{"type":1,"id":1,"method":"auth","payload":{token,tokenType:"JWT",receiveUnread?}}`,
   ответ — `{"type":2,"id":1,"payload":{"userId":"…"}}`.
3. **Запрос/ответ**: `{type:1, id:N, method, payload}` → `{type:2, id:N, payload}`; `id`
   монотонно растёт в рамках соединения, повтор даёт `errorCode 2`. Ответы приходят в произвольном
   порядке — клиент мультиплексирует их по `id`.
4. **События** приходят как `type:1` с методом `sendMessage`/`command`/… . Каждое событие **обязательно**
   подтвердить `{type:2, id}` в течение 300 секунд, иначе сервер закроет соединение. Подтверждение
   одновременно означает «бот прочитал сообщение».
5. **Файлы**: `uploadFile` (WS) → `uploadTaskId` → `POST /bridge/api/client/v1/files` (multipart,
   заголовок `Upload-Task-Id`) → `temporalFileId` → `sendFile` (WS).

Полный контракт — [research/chatbot-connector.md](research/chatbot-connector.md).

## Решения

### Один общий WebSocket-клиент на бота (для action-нод)

`getBridgeClient()` возвращает singleton из реестра по ключу `origin|username|hash(password)`.
Причины: лимит 128 WS-соединений на сервер, дорогой handshake+auth на каждый вызов, единая точка
реконнекта. Клиент закрывает сокет после 10 минут простоя, чтобы не держать соединения «на всякий
случай».

Триггер создаёт **собственный** клиент: если action-вызов уронит общее соединение, приём событий
не должен останавливаться. Дополнительно это исключает гонку «кто первый подтвердил событие».

### JWT кешируется, а не запрашивается на каждый запуск

Токен живёт месяц; кеш ключуется сервером, логином и хешем пароля. При `errorCode 200/203`
клиент сбрасывает кеш, переподключается и повторяет запрос один раз.

### `ws` вместо глобального `WebSocket` Node.js

Глобальный `WebSocket` (undici) не позволяет управлять проверкой TLS для самоподписанных
сертификатов TrueConf. Пакет `ws` даёт `rejectUnauthorized` per-connection и предсказуемо работает
на всех поддерживаемых версиях Node. `ws` включён в tarball (`bundleDependencies`), поэтому на
сервере не нужен `npm install`.

### Multipart собирается вручную

`buildMultipartBody()` формирует тело с точным boundary и полями `file`/`preview`. Это не зависит от
того, какую реализацию `FormData` использует конкретная версия n8n, и легко проверяется unit-тестами.

### Обработка ошибок

Коды TrueConf (`200` not authorized, `201` chat not found, `203` token expired, `310` file limits …)
превращаются в `TrueConfError` с человекочитаемым текстом; нода оборачивает их в `NodeOperationError`
с `itemIndex`. При включённом «Continue On Fail» ошибка попадает в `json.error` item-а.

### Определение «chat id или TrueConf ID»

TrueConf ID всегда содержит `@` (или `domain\user`), chat id — hex-строка. Если в поле **Chat ID or
TrueConf ID** есть `@`, нода сначала вызывает `createP2PChat` и получает/создаёт личный чат, затем
отправляет сообщение. Это поведение задокументировано в подсказке поля.

### Триггер: активация и ручной запуск

`trigger()` подключается, регистрирует обработчик и возвращает `closeFunction`. В ручном режиме
(`getMode() === 'manual'`) дополнительно возвращается `manualTriggerFunction`, который ждёт первого
события до 120 секунд — так кнопка «Test step» показывает реальные данные, а не пустой результат.

### Идемпотентность и порядок

Протокол push-only: события приходят по одному соединению, порядок внутри чата определяется
`box.id` + `box.position` (не `timestamp`). Нода не гарантирует exactly-once: при реконнекте с
`receiveUnread=true` сервер может повторно отдать неподтверждённые сообщения. Для дедупликации в
workflow используйте `messageId`.

## Что сознательно не сделано

* **Server API v4** (пользователи, конференции) — отдельный REST с OAuth2; для него нужна вторая
  credential-модель и отдельная нода. Контракт уже исследован: [research/server-api-v4.md](research/server-api-v4.md).
* **Inline-кнопки** — протокол поддерживает (5.5.6+), UI-параметры не выведены.
* **Опросы, геолокация, голосовые** — методы есть в API, в ноде не реализованы.
* **Webhook-режим** — у Chatbot Connector его нет, только WebSocket.

## Совместимость

| Версия n8n | Статус |
|---|---|
| 2.47.7 | проверено (unit + e2e на mock Bridge) |
| 2.4x | ожидается совместимость: используется стабильный API `n8n-workflow` 2.47.2 |
| 1.x | не поддерживается (`n8nNodesApiVersion: 1` совместим, но не тестировалось) |
