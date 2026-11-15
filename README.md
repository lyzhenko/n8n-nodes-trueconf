# n8n-nodes-trueconf

Community-нода для [n8n](https://n8n.io) — интеграция с **TrueConf Server** через Chatbot Connector
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

* n8n **2.x** (проверено на 2.47.7), Node.js >= 24 (в n8n 2.x это требование платформы).
* TrueConf Server **5.5.0+** (TrueConf Server Free подходит: Chatbot Connector входит в бесплатную
  редакцию). Нужна обычная учётная запись пользователя-бота с паролем.
* Сетевой доступ из n8n до TrueConf Bridge: `http://<server>:4309` (локально) или
  `https://<server>` через TrueConf Web Manager.

Подробнее о подготовке сервера и бота — [docs/trueconf-prerequisites.md](docs/trueconf-prerequisites.md).

## Установка

Пакет ставится на хост n8n вручную, из собранного tarball (публикация в npm не требуется).

```bash
# 1. Собрать пакет (на машине разработчика)
npm install
npm run build
npm pack                       # -> n8n-nodes-trueconf-0.1.0.tgz

# 2. На хосте n8n (root)
install -d -o n8n -g n8n -m 0750 /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf
tar -xzf n8n-nodes-trueconf-0.1.0.tgz \
    -C /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf --strip-components=1
chown -R n8n:n8n /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf

# 3. Перезапустить n8n (пакеты читаются с диска при старте)
systemctl restart n8n
```

Автоматизированный вариант — `deploy/deploy.py` (собирает, копирует по SSH, ставит, перезапускает):

```bash
cp deploy/.env.example deploy/.env    # SSH-доступ к хосту n8n
python deploy/deploy.py
```

После перезапуска ноды `TrueConf` и `TrueConf Trigger` появляются в панели узлов.
Подробности и обновление — [docs/installation.md](docs/installation.md).

## Настройка

1. **Credentials → New → TrueConf API**
   * **Server URL** — `http://192.168.0.11:4309` (локальный Bridge) или `https://trueconf.example.com`.
     Схему можно не указывать, по умолчанию `http`.
   * **Bot TrueConf ID** — логин бота, например `bot@video.example.com`.
   * **Bot Password** — пароль бота.
   * **Ignore SSL Issues** — включить для самоподписанного сертификата TrueConf.
2. Нажмите **Test** — должно появиться `Connection successful!`.

## Использование

### Отправить сообщение

1. Добавьте ноду **TrueConf**, ресурс `Message`, операция `Send Message`.
2. В поле **Chat ID or TrueConf ID** укажите:
   * `chatId` существующего чата (например, из trigger-ноды), **или**
   * TrueConf ID пользователя (`user@video.example.com`) — тогда бот откроет (или найдёт) личный чат.
3. Текст, режим разметки (`text` / `markdown` / `html`), при необходимости — `Reply to Message ID`.

### Отправка файла

Операция `Send File` берёт файл из бинарного поля входного item (по умолчанию `data`). Типичная
цепочка: `HTTP Request` (Response Format = File) → `TrueConf: Send File`, либо `Read Binary File`.

### Ответ на входящее сообщение

`TrueConf Trigger` (событие **Message Received**) → нужная логика → `TrueConf: Send Message`, где
**Chat ID or TrueConf ID** = `{{ $json.chatId }}`, а **Reply to Message ID** = `{{ $json.messageId }}`.

Триггер отдаёт удобные поля: `chatId`, `chatTitle`, `chatType`, `messageId`, `authorId`, `authorType`,
`text`, `parseMode`, `contentType`, `timestamp`, `replyMessageId`, `isFile…`, а исходный объект
TrueConf — в `raw`.

Готовые workflow для импорта — в каталоге [examples/](examples/).

## Разработка

```bash
npm install
npm run build        # tsc + копирование иконок в dist/
npm test             # unit-тесты протокола против mock TrueConf Bridge (14 проверок)
npm run typecheck
```

E2E-проверка на живом n8n (создаёт credential и workflow через REST API, гоняет sendMessage, getChats,
sendFile и trigger через mock Bridge, запущенный на хосте n8n):

```bash
python deploy/e2e.py start     # поднять mock Bridge (systemd unit tc-e2e) на 127.0.0.1:4309
python deploy/e2e.py setup     # создать credential и workflow в n8n
python deploy/e2e.py suite     # прогнать 13 проверок
python deploy/e2e.py stop      # остановить mock
```

Подробнее — [docs/testing.md](docs/testing.md), устройство — [docs/architecture.md](docs/architecture.md).

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
deploy/                                    # установка пакета и e2e-стенд (Python + paramiko)
examples/                                  # workflow JSON для импорта
tests/                                     # unit-тесты и mock TrueConf Bridge
docs/                                      # установка, архитектура, тестирование, исследование API
```

## Ограничения и особенности

* **Одно WebSocket-соединение на бота.** Все выполнения workflow переиспользуют общий клиент
  (в TrueConf лимит 128 соединений на сервер). Trigger открывает собственное соединение, чтобы
  падение action-вызовов не влияло на приём событий.
* **Протокол push-only.** TrueConf присылает события по WebSocket; webhook-режима у Chatbot Connector
  нет, поэтому trigger-нода держит постоянное соединение и переподключается с backoff.
* **Подтверждение событий.** Каждое уведомление сервера подтверждается автоматически — без этого
  TrueConf разрывает соединение через 300 секунд.
* **Разметка.** TrueConf поддерживает `text`, `markdown`, `html`; inline-кнопки доступны начиная
  с TrueConf Server 5.5.6 (в ноде пока не выведены в UI).
* **Только Chatbot Connector.** Администрирование сервера (пользователи, конференции) — это другой
  API (TrueConf Server API v4 с OAuth2), в этой ноде его нет: см. [docs/research/server-api-v4.md](docs/research/server-api-v4.md).

## Документация

* [Установка и обновление](docs/installation.md)
* [Архитектура и принятые решения](docs/architecture.md)
* [Тестирование](docs/testing.md)
* [Подготовка TrueConf Server и бота](docs/trueconf-prerequisites.md)
* [Исследование API Chatbot Connector](docs/research/chatbot-connector.md) (контракт, 34 метода, события, ошибки)
* [Исследование Server API v4](docs/research/server-api-v4.md)
* [Механика community-нод n8n 2.47](docs/research/n8n-custom-node.md)

Официальная документация: [TrueConf Chatbot Connector](https://trueconf.ru/docs/chatbot-connector/ru/overview/),
[TrueConf Server](https://trueconf.ru/docs/main/ru/).

## Лицензия

MIT
