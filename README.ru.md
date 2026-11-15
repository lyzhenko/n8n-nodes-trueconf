# n8n-nodes-trueconf

Community-нода [n8n](https://n8n.io) для интеграции с **TrueConf Server** через Chatbot Connector
(HTTP API + WebSocket). Аналог ноды Telegram: бот получает сообщения в реальном времени и отвечает
текстом или файлами.

```
n8n workflow:  [TrueConf Trigger] ──► [любая логика n8n] ──► [TrueConf: Send Message]
```

## Что умеет

**Нода `TrueConf` (action)**

| Ресурс  | Операции |
|---|---|
| Message | Send Message, Send File, Edit Message, Delete Message, Forward Message, Get Message, Get Chat History |
| Chat    | Get Many, Get, Create Personal Chat, Create Group Chat, Create Channel, Get Participants |
| Bot     | Get Bot Info (проверка связи и TrueConf ID бота) |

**Нода `TrueConf Trigger`** — запускает workflow по событиям TrueConf: новое сообщение, нажатие
inline-кнопки, создание чата, изменение участников, редактирование/удаление сообщения, изменение чата.
Есть фильтры по событиям и по chat ID, опция «не реагировать на собственные сообщения» и доставка
сообщений, накопившихся пока workflow был выключен.

**Credential `TrueConf API`** — адрес сервера, TrueConf ID бота и пароль. JWT кешируется на месяц,
кнопка «Test» проверяет учётные данные реальным запросом к серверу.

## Требования

* n8n **2.x** (проверено на 2.47.7), Node.js >= 24 (требование платформы n8n 2.x).
* TrueConf Server **5.5.0+** (TrueConf Server Free подходит: Chatbot Connector входит в бесплатную
  редакцию). Бот — обычная учётная запись пользователя с паролем.
* Сетевой доступ из n8n до TrueConf Bridge: `http://<server>:4309` (локально) или
  `https://<server>` через TrueConf Web Manager.

Подготовка сервера и бота — [docs/trueconf-prerequisites.md](docs/trueconf-prerequisites.md).

## Установка

### Из npm (рекомендуется)

1. n8n → **Settings → Community nodes → Install**.
2. Ввести `n8n-nodes-trueconf` и подтвердить.
3. На self-hosted инстансе пакет должен быть разрешён: `N8N_UNVERIFIED_PACKAGES_ENABLED=true`.

### Вручную из tarball

```bash
npm install
npm run build
npm pack                       # -> n8n-nodes-trueconf-0.1.0.tgz

# на хосте n8n (root)
install -d -o n8n -g n8n -m 0750 /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf
tar -xzf n8n-nodes-trueconf-0.1.0.tgz \
    -C /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf --strip-components=1
chown -R n8n:n8n /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf

systemctl restart n8n
```

`/var/lib/n8n` — это `N8N_USER_FOLDER` данного развёртывания; для обычной npm-установки это `~/.n8n`,
для Docker — примонтированный volume. Пакет везёт единственную runtime-зависимость (`ws`) внутри
себя, поэтому `npm install` на сервере не нужен.

Подробнее — [docs/installation.md](docs/installation.md).

## Настройка

1. **Credentials → New → TrueConf API**
   * **Server URL** — `http://trueconf.example.com:4309` (локальный Bridge) или
     `https://trueconf.example.com`. Схему можно не указывать, по умолчанию `http`.
   * **Bot TrueConf ID** — например `bot@example.trueconf.name`.
   * **Bot Password** — пароль бота.
   * **Ignore SSL Issues** — для самоподписанного сертификата TrueConf.
2. Нажмите **Test** — должно появиться `Connection successful!`.

## Использование

### Отправить сообщение

1. Добавьте ноду **TrueConf**, ресурс `Message`, операция `Send Message`.
2. В поле **Chat ID or TrueConf ID** укажите chat id (например, из trigger-ноды) **или** TrueConf ID
   пользователя (`user@example.trueconf.name`) — тогда бот откроет (или найдёт) личный чат.
3. Текст, режим разметки (`text` / `markdown` / `html`), при необходимости — `Reply to Message ID`.

### Отправка файла

Операция `Send File` берёт файл из бинарного поля входного item (по умолчанию `data`). Типичная
цепочка: `HTTP Request` (Response Format = File) → `TrueConf: Send File`, либо `Read Binary File`.

### Ответ на входящее сообщение

`TrueConf Trigger` (событие **Message Received**) → нужная логика → `TrueConf: Send Message`, где
**Chat ID or TrueConf ID** = `{{ $json.chatId }}`, а **Reply to Message ID** = `{{ $json.messageId }}`.

Триггер отдаёт поля `chatId`, `chatTitle`, `chatType`, `messageId`, `authorId`, `authorType`, `text`,
`parseMode`, `contentType`, `timestamp`, `replyMessageId`, поля вложений, а исходный объект TrueConf —
в `raw`.

Готовые workflow для импорта — [examples/](examples/).

## Разработка

```bash
npm install
npm run build        # tsc + копирование иконок в dist/
npm test             # unit-тесты протокола против mock TrueConf Bridge (14 проверок)
npm run typecheck
```

E2E и живые тесты описаны в [docs/testing.md](docs/testing.md), устройство — в
[docs/architecture.md](docs/architecture.md).

## Структура репозитория

```
src/
  credentials/TrueConfApi.credentials.ts   # credential + кнопка Test
  nodes/TrueConf/
    BridgeClient.ts                        # WebSocket-клиент: auth, id, ack, реконнект, кеш JWT
    GenericFunctions.ts                    # multipart-загрузка файлов, разбор Envelope
    TrueConf.node.ts                       # action-нода
    TrueConfTrigger.node.ts                # trigger-нода
    descriptions/                          # параметры UI по ресурсам
tests/                                     # unit-тесты и mock TrueConf Bridge
examples/                                  # workflow JSON для импорта
docs/                                      # установка, архитектура, тестирование, исследование API
```

## Ограничения

* **Одно WebSocket-соединение на бота.** Все выполнения workflow переиспользуют общий клиент
  (в TrueConf лимит 128 соединений на сервер). Trigger открывает собственное соединение, чтобы
  падение action-вызовов не влияло на приём событий.
* **Протокол push-only.** Webhook-режима у Chatbot Connector нет, поэтому trigger держит постоянное
  соединение и переподключается с backoff.
* **Подтверждение событий.** Каждое уведомление подтверждается автоматически — иначе TrueConf
  разрывает соединение через 300 секунд.
* **Разметка.** Поддерживаются `text`, `markdown`, `html`; inline-кнопки (5.5.6+) в UI пока не выведены.
* **Только Chatbot Connector.** Администрирование сервера (пользователи, конференции) — это TrueConf
  Server API v4 с OAuth2, в ноде его нет.

## Документация

* [Установка и обновление](docs/installation.md)
* [Архитектура и принятые решения](docs/architecture.md)
* [Тестирование](docs/testing.md)
* [Подготовка TrueConf Server и бота](docs/trueconf-prerequisites.md)
* [Исследование API Chatbot Connector](docs/research/chatbot-connector.md)

Официальная документация: [TrueConf Chatbot Connector](https://trueconf.ru/docs/chatbot-connector/ru/overview/),
[TrueConf Server](https://trueconf.ru/docs/main/ru/).

## Лицензия

[MIT](LICENSE)

---

English version: [README.md](README.md)
