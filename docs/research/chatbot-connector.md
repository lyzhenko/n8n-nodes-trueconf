# TrueConf Chatbot Connector — API-контракт (исследование для n8n-ноды)

> Статус: черновик спецификации, собран по официальной документации и референсной библиотеке.
> Дата сбора: 2026-11-15. Все утверждения помечены источником. Где документация молчит или противоречит
> сама себе — стоит пометка **НЕ ПОДТВЕРЖДЕНО**.
>
> Документ описывает только то, что нужно для community-node n8n (отправка/приём сообщений),
> но перечисляет и остальные методы API, чтобы не выяснять их потом заново.

---

## 0. Источники и способ проверки

Официальная документация (русская версия; английское зеркало `/docs/chatbot-connector/en/...` имеет те же разделы):

| Раздел | URL |
| --- | --- |
| Общее описание | https://trueconf.ru/docs/chatbot-connector/ru/overview/ |
| Введение (подключение и авторизация) | https://trueconf.ru/docs/chatbot-connector/ru/connect-and-auth/ |
| Основы протокола | https://trueconf.ru/docs/chatbot-connector/ru/base-format-message/ |
| Роли и права участников | https://trueconf.ru/docs/chatbot-connector/ru/roles-and-users-rules/ |
| Работа с чатами | https://trueconf.ru/docs/chatbot-connector/ru/chats/ |
| Работа с участниками | https://trueconf.ru/docs/chatbot-connector/ru/members/ |
| Работа с сообщениями | https://trueconf.ru/docs/chatbot-connector/ru/messages/ |
| Работа с файлами | https://trueconf.ru/docs/chatbot-connector/ru/files/ |
| Форматирование текста | https://trueconf.ru/docs/chatbot-connector/ru/formatting/ |
| Интерактивные кнопки | https://trueconf.ru/docs/chatbot-connector/ru/buttons/ |
| Активность бота | https://trueconf.ru/docs/chatbot-connector/ru/activity/ |
| Работа с контактами | https://trueconf.ru/docs/chatbot-connector/ru/contacts/ |
| Работа с опросами | https://trueconf.ru/docs/chatbot-connector/ru/surveys/ |
| Коды ошибок | https://trueconf.ru/docs/chatbot-connector/ru/errors/ |
| Справочник API (Envelope, enum'ы) | https://trueconf.ru/docs/chatbot-connector/ru/objects/ |

PDF-версия всей документации: https://trueconf.ru/docs/manual/sdk/trueconf-chatbot-connector-ru.pdf

Референсная реализация (использована для проверки полей запросов, которых нет в примерах):

* https://github.com/trueconf/python-trueconf-bot — `trueconf/methods/*.py`, `trueconf/types/*`, `trueconf/enums/*`, `docs/ru/learn/*`.
  Версия на момент проверки — 1.5.5.

Скачанные артефакты (полные HTML-копии страниц и исходники библиотеки), чтобы можно было перепроверить:
`docs/research/_raw/` (HTML + извлечённый текст в `_raw/txt/`), `docs/research/_raw/gh/` (библиотека),
`docs/research/_raw/srv/` (админ-документация TrueConf Server).

---

## 1. Версии, редакции, доступность

| Факт | Статус |
| --- | --- |
| API чат-ботов поставляется в составе TrueConf Server **с версии 5.5.0** | подтверждено (overview) |
| С **5.5.3** число одновременных WebSocket-соединений ограничено **128** (т.е. до 128 ботов на сервер) | подтверждено (overview, connect-and-auth) |
| С **5.5.4** один JWT-токен можно использовать в нескольких WebSocket-соединениях | подтверждено (connect-and-auth) |
| С **5.5.6** — inline-кнопки, голосовые сообщения, `chat`/`replyMessage` в Envelope | подтверждено (buttons, objects, release notes библиотеки) |
| Минимальная версия для OAuth-авторизации вместо логина/пароля — **5.5.3+** | подтверждено (connect-and-auth) |
| Функционал чат-ботов поддерживается начиная с TrueConf Server 5.5, а также в **TrueConf Enterprise и TrueConf Server Free** | подтверждено README библиотеки (https://github.com/TrueConf/python-trueconf-bot/blob/master/README-ru.md) |
| Chatbot Connector **не входит** в таблицу платных расширений лицензирования TrueConf Server (там перечислены LDAP, SIP-шлюз, вебинары, синхроперевод, календарь, ИИ-сервер, федерация, DLP, Enterprise-компоненты) | подтверждено (https://trueconf.ru/docs/server/ru/admin/license/) — косвенное подтверждение бесплатности |
| В списке возможностей **TrueConf Server Free** на странице цен указано «APIs for meetings, endpoints, and chatbots» | подтверждено (https://trueconf.com/pricing/server-price.html) |

Вывод для ноды: целимся в **TrueConf Server >= 5.5.0**; фичи 5.5.3/5.5.6 (кнопки, activity, `chat`, `replyMessage`)
должны быть опциональными и проверяться по версии сервера. Определить версию можно вне протокола чат-ботов:
`GET {base}/api/v4/server` (так делает библиотека) — **НЕ ПОДТВЕРЖДЕНО** документацией Chatbot Connector,
но это публичный REST API сервера.

---

## 2. Транспорт, базовые URL, порты

Служба **TrueConf Bridge** обеспечивает HTTP и WebSocket для чатов и слушает **TCP 4309** (без шифрования).
Шифрованный доступ идёт через **TrueConf Web Manager** (веб-сервер Труконф), который проксирует
HTTPS-запросы к `/bridge/api/` в Bridge.

| Назначение | Локально (напрямую в Bridge) | Через Web Manager (HTTPS/WSS) |
| --- | --- | --- |
| HTTP API (токен, загрузка/скачивание файлов) | `http://localhost:4309/bridge/api/` | `https://bot.example.net/bridge/api/` |
| WebSocket чат-бота | `ws://localhost:4309/websocket/chat_bot/` | `wss://bot.example.net/websocket/chat_bot/` |

* Порт по умолчанию для HTTPS/WSS — **443**; если в панели управления задан другой веб-порт, он подставляется в URL.
* HTTP-незашифрованные соединения допустимы только локально (разработка).
* WebSocket-подпротокол — **`json.v1`**, передаётся в заголовке `Sec-WebSocket-Protocol`;
  если заголовок не указан, сервер использует `json.v1` по умолчанию. (connect-and-auth)
* Путь WS в документации указан со слэшем на конце (`/websocket/chat_bot/`); библиотека подключается
  к `/websocket/chat_bot` без слэша и работает → слэш не критичен. **НЕ ПОДТВЕРЖДЕНО** формально,
  но обе формы присутствуют в первоисточниках.

Полный HTTP-API, который реально используется (по документации): только
(1) получение токена и (2) загрузка файла; скачивание файла — GET по `downloadUrl`.
Всё остальное — через WebSocket.

---

## 3. Аутентификация

Схема из трёх шагов (connect-and-auth):

1. HTTP-запрос → идентификационный токен (JWT).
2. Установка WebSocket-соединения.
3. Команда `auth` по WebSocket с этим токеном.

Без `auth` любой запрос вернёт ошибку **`errorCode = 200` (NOT_AUTHORIZED)**.

### 3.1. Учётная запись бота

* Разрешены **только учётные записи пользователей текущего TrueConf Server** (Registry или LDAP).
* НЕ поддерживаются: пользователи других серверов (в т.ч. по федерации) и гостевые учётные записи.
* Форматы логина: `user`, `user@video.example.com`, `department.mycompany\john`,
  `department.mycompany\john@server.loc`.
* Специального флага «это бот» в документации Chatbot Connector **нет** — см. §12.

### 3.2. Способ A: логин/пароль (основной)

```http
POST /bridge/api/client/v1/oauth/token HTTP/1.1
Host: localhost:4309
Content-Type: application/json

{
    "client_id": "chat_bot",
    "grant_type": "password",
    "username": "user",
    "password": "qwerty"
}
```

| Поле | Значение |
| --- | --- |
| `client_id` | константа `"chat_bot"` |
| `grant_type` | константа `"password"` |
| `username` | логин бота |
| `password` | пароль бота |

Успех — **HTTP 201 Created**:

```json
{
    "access_token": "eyJhbGciOiJSU0EtT0FFUCIsImVuYyI6IkEyNTZHQ00ifQ",
    "token_type": "JWT",
    "expires_at": 1761121632
}
```

| Поле | Смысл |
| --- | --- |
| `access_token` | JWT для `auth` по WebSocket |
| `token_type` | константа `"JWT"` |
| `expires_at` | срок жизни — **один месяц** с момента выдачи; далее нужна повторная авторизация |

Ошибка — **HTTP 400 Bad Request**:

```json
{ "error": "invalid_grant", "error_description": "Invalid username or password" }
```

`error` — значение из перечисления `OAUTH_ERROR` (`invalid_request`, `invalid_client`, `invalid_grant`,
`unsupported_grant_type`).

> **Расхождение.** В документации ошибка неверных учётных данных — `400 invalid_grant`.
> В библиотеке обрабатывается `401` (и только при наличии `error_description` → `InvalidGrantError`),
> а также `403` с `error = "auth_method_disabled"` → `PasswordAuthDisabledError`
> (`trueconf/utils/_auth/_token.py`). Код `403 auth_method_disabled` в документации Chatbot Connector
> **не описан** — **НЕ ПОДТВЕРЖДЕНО** документацией, но подтверждено практикой библиотеки.
> Для ноды: трактовать 400/401 как «неверные учётные данные», 403 + `auth_method_disabled` —
> «на сервере отключён вход по паролю, нужен OAuth-способ».

### 3.3. Способ B: через OAuth 2.0-приложение (5.5.3+)

Нужен, если на сервере (или в зоне, откуда подключается бот) отключён вход по логину/паролю
(NTLM, Kerberos, MFA). Администратор создаёт OAuth-приложение в **API → OAuth2** панели управления;
у приложения должно быть право (scope) **`version:read`**, иначе `400 invalidScope`.

**Этап 1.** `POST /api/v4/oauth2/token` (обычный REST API сервера, не Bridge):

```json
{ "client_id": "QuWJ9XWvT9otdy9RSAduGA", "grant_type": "password", "username": "bot", "password": "123tr" }
```

Ответ: `access_token`, `expires_in` (3600 с), `refresh_token`, `scope`, `token_type: "bearer"`, `user_id`.

**Этап 2.** `POST /bridge/api/client/v1/auth/web_rest_api_token`:

```json
{ "client_id": "bot", "token": "<access_token из этапа 1>" }
```

Ответ: `{ "authorization_code": "...", "expires_in": 1790696252969 }` — `expires_in` здесь
и на этапе 3 означает **момент истечения в миллисекундах Unix**, а не длительность.

**Этап 3.** `POST /bridge/api/client/v1/auth/token`:

```json
{ "client_id": "bot", "grant_type": "authorization_code", "code": "<authorization_code>" }
```

Ответ: `{ "access_token": "<JWT>", "token_type": "JWT", "expires_in": 1793284714098 }` — снова
момент истечения в мс; срок жизни токена — один месяц.

Ошибки: `401` (неверные учётные данные или client_id) либо `400` с `invalidScope`.

> **Расхождение.** В примере этапа 3 документация передаёт `client_id` = логин бота (`"bot"`),
> а библиотека передаёт литерал `"user"` (`trueconf/utils/_auth/_token.py`, шаг `r3`).
> Скорее всего ошибка в библиотеке; в ноде брать логин бота. **НЕ ПОДТВЕРЖДЕНО**, что сервер
> валидирует это поле на этапе 3.

### 3.4. Авторизация WebSocket

```json
{
  "type": 1,
  "id": 1,
  "method": "auth",
  "payload": {
    "token": "someToken",
    "tokenType": "JWT",
    "receiveUnread": false,
    "receiveSystemMessageEnvelopes": true
  }
}
```

| Поле payload | Тип | Обяз. | Смысл |
| --- | --- | --- | --- |
| `token` | string | да | JWT из HTTP-этапа |
| `tokenType` | string | да | `"JWT"` |
| `receiveUnread` | bool | нет | дослать непрочитанные сообщения, накопившиеся пока бот был offline. Отдаются по одному, от старых к новым, **максимум 1000**. По умолчанию `false` |
| `receiveSystemMessageEnvelopes` | bool | нет | 5.5.3+; получать ли системные сообщения (Envelope с `type < 200`). По умолчанию `true` |

Ответ:

```json
{ "type": 2, "id": 1, "payload": { "userId": "someTrueConfUserId@someTrueConfServerName/someHash" } }
```

`payload.userId` — TrueConf ID авторизованного бота. Обратите внимание на формат в примере:
`user@server/someHash` — то есть TrueConf ID может содержать суффикс; сравнивать «свой/чужой»
по `author.id` нужно осторожно (**НЕ ПОДТВЕРЖДЕНО**, всегда ли присутствует `/hash`).

Токен живёт месяц; **уже установленное соединение продолжает работать после истечения токена**
до разрыва соединения (docs/ru/learn/authentication.md библиотеки). Практический вывод для ноды:
токен кэшировать, переполучать по `expires_at`/`401`/`203`, а не на каждый реконнект.

---

## 4. Конверт сообщения (framing)

Любое сообщение — JSON-объект минимум с двумя полями:

```json
{ "type": 1, "id": 1 }
```

| Поле | Тип | Обяз. | Смысл |
| --- | --- | --- | --- |
| `type` | uint32 | да | `0` RESERVED, **`1` REQUEST**, **`2` RESPONSE**. Реально используются только 1 и 2 |
| `id` | uint32 | да | Уникальный инкрементируемый идентификатор; связывает запрос и ответ |
| `method` | string | да (в запросах) | Имя команды |
| `payload` | object | зависит от метода | Тело команды |

Правила (base-format-message):

* `id` уникален и **монотонно возрастает в рамках соединения**: повтор `id` → ошибка `errorCode = 2`
  (INVALID_REQUEST_ID); `id` меньше уже использованного → тоже ошибка.
* Ответ на запрос — `type: 2` с тем же `id`; `payload` может отсутствовать (пустой ответ).
* Ответы могут приходить в любом порядке (асинхронность разрешена).
* **Каждое уведомление сервера необходимо подтвердить** ответом `{"type":2,"id":<id уведомления>}`.
  Если сервер не получит подтверждение в течение **300 секунд**, соединение считается неактивным
  и закрывается — независимо от ping/pong. Ответ на уведомление о новом сообщении одновременно
  означает «бот прочитал сообщение» (в клиенте появляется галочка).
* Таймаут ответа на запрос — тоже 300 с (5 минут); долгие операции оформляются несколькими
  запрос-ответами.
* Ошибка возвращается как `{"type":2,"id":N,"payload":{"errorCode":<код>}}`.

Пример пары:

```json
{ "type": 1, "id": 23768, "method": "getCurrentTime" }
```
```json
{ "type": 2, "id": 23768, "payload": { "data": 1724936321584 } }
```

`ping` и `getCurrentTime` в документации встречаются только как примеры механики `id`
(не как обязательный heartbeat). **НЕ ПОДТВЕРЖДЕНО**, требуется ли прикладной ping:
сервер закрывает соединение по отсутствию подтверждений, а не по отсутствию ping.
Библиотека отдельного ping-цикла не делает.

**Для n8n:** это push-протокол. Одна WS-сессия на бота; нужен собственный счётчик `id`,
таблица ожидающих ответов, авто-подтверждение всех входящих `type: 1` и реконнект.

---

## 5. Объект Envelope (сообщение)

`payload` уведомления `sendMessage`, результат `getMessageById` и элементы `messages[]` в
`getChatHistory` — это один и тот же объект Envelope (objects#Envelope):

```ts
interface Envelope {
  chat: Chat;              // инфо о чате
  chatId?: string;         // DEPRECATED с 5.5.6 — использовать chat.chatId
  messageId: string;
  timestamp: number;       // Unix ms
  replyMessage?: Envelope; // исходное сообщение, если это ответ (5.5.6+)
  replyMessageId?: string;
  isEdited: boolean;
  type: EnvelopeContentType;// тип контента
  author: { id: string; type: 0|1 };
  box: { id: number; position: string };
  content: object;         // состав зависит от type
}
```

`Chat`:

```ts
interface Chat {
  chatId: string;
  chatTitle: string | null; // для P2P — TrueConf ID собеседника, для «Избранного» — null
  chatType: ChatTypeEnum;
}
```

`author.type` — `EnvelopeAuthorTypeEnum`: `0` SYSTEM (автор — сервер, `id` = имя сервера),
`1` USER (автор — пользователь, `id` = TrueConf ID). В JSON это число (`"type": 1`).

`box` — механизм сортировки: `id` — автоинкремент в рамках чата, `position` — порядок внутри
«коробки» (обычно `"0"`; при коллизии — строка из алфавита `0-9A-Za-z{}`, сравнивать по ASCII).
Для сортировки: сначала `box.id`, затем `box.position` как строку.

Состав `content` по `type` (objects#AbstractEnvelopeContent):

| type | Контент |
| --- | --- |
| `1` ADD_PARTICIPANT | `{ userId, role }` |
| `2` REMOVE_PARTICIPANT | `{ userId }` |
| `21` EDIT_CHAT_TITLE | `{ title }` |
| `22` EDIT_CHAT_AVATAR | `{ avatarUrl: string\|null }` |
| `23` CLEAR_CHAT_HISTORY | `{ forAll: boolean }` |
| `110` PARTICIPANT_ROLE | `{ userId, role }` |
| `200` PLAIN_MESSAGE | `{ text, parseMode, buttons? }` |
| `201` FORWARDED_MESSAGE | вложенный Envelope **без** `box` |
| `202` ATTACHMENT | `{ name, mimeType, fileId, size }` |
| `203` GEOLOCATION | `{ latitude, longitude, title }` |
| `204` SURVEY | `{ url, appVersion, path, title, description, buttonText, secret, alt }` |
| `205` VOICE (5.5.6+) | `{ mimeType, fileId, size, duration }` (duration — мс) |

Правило разделения: `type < 200` — системное сообщение (только лог/подпись события),
`type >= 200` — пользовательское. Системные сообщения можно отключить флагом
`receiveSystemMessageEnvelopes: false` при `auth`.

---

## 6. Полный список методов

### 6.1. Сводная таблица (все 34 метода клиента)

Колонка «с» — минимальная версия сервера, если она указана в документации.

| # | method | Назначение | с |
| --- | --- | --- | --- |
| 1 | `auth` | авторизация WS | 5.5.0 |
| 2 | `sendMessage` | отправить текст (и/или inline-кнопки) | 5.5.0 (buttons 5.5.6) |
| 3 | `editMessage` | изменить сообщение | 5.5.0 |
| 4 | `forwardMessage` | переслать | 5.5.0 |
| 5 | `removeMessage` | удалить | 5.5.0 |
| 6 | `getMessageById` | получить сообщение | 5.5.0 |
| 7 | `sendFile` | отправить ранее загруженный файл | 5.5.0 (caption 5.5.2) |
| 8 | `uploadFile` | создать задачу загрузки | 5.5.0 (`fileName` 5.5.3) |
| 9 | `getFileInfo` | инфо о файле + `downloadUrl` | 5.5.0 (`fileId` 5.5.4) |
| 10 | `subscribeFileProgress` | подписка на прогресс загрузки | — |
| 11 | `unsubscribeFileProgress` | отписка | — |
| 12 | `getFileUploadLimits` | лимиты хранилища | 5.5.3 |
| 13 | `sendSurvey` | отправить опрос | — (версия не указана) |
| 14 | `editSurvey` | изменить опрос | — |
| 15 | `createP2PChat` | личный чат | 5.5.0 |
| 16 | `createGroupChat` | групповой чат | 5.5.0 |
| 17 | `createChannel` | канал | 5.5.0 |
| 18 | `createFavoritesChat` | чат «Избранное» | 5.5.2 |
| 19 | `removeChat` | удалить чат | 5.5.0 |
| 20 | `editChatTitle` | переименовать чат | 5.5.3 |
| 21 | `editChatAvatar` | сменить аватар чата | 5.5.3 |
| 22 | `getChatHistory` | история сообщений | 5.5.0 |
| 23 | `clearHistory` | очистить историю | 5.5.3 |
| 24 | `getChatByID` | инфо о чате (обратите внимание: `ID`, не `Id`) | 5.5.0 |
| 25 | `getChats` | список чатов (пейджинг) | 5.5.0 |
| 26 | `addChatParticipant` | добавить участника | 5.5.0 (`displayHistory` 5.5.3) |
| 27 | `removeChatParticipant` | удалить участника | 5.5.0 (`clearHistory` 5.5.3) |
| 28 | `changeParticipantRole` | изменить роль | 5.5.2 |
| 29 | `getChatParticipant` | участник чата | 5.5.3 |
| 30 | `getChatParticipants` | список участников | 5.5.0 |
| 31 | `hasChatParticipant` | проверка участия (deprecated с 5.5.3 → `getChatParticipant`) | 5.5.0 |
| 32 | `sendChatActivity` | «печатает…» и др. | 5.5.6 (по release notes библиотеки; в API-документации версия не указана) |
| 33 | `getUserDisplayName` | отображаемое имя по TrueConf ID | — (версия не указана) |
| 34 | `answerCommand` | ответ на команду кнопки (`waitReply: true`) | 5.5.6 (кнопки) |

Сервер шлёт клиенту отдельные уведомления с `method`: `sendMessage`, `editMessage`, `removeMessage`,
`command`, `createP2PChat`, `createGroupChat`, `createChannel`, `createFavoritesChat`, `editChatTitle`,
`editChatAvatar`, `clearHistory`, `removeChat`, `addChatParticipant`, `removeChatParticipant`,
`changeParticipantRole`, `getFileUploadLimits`, `uploadingProgress` (см. §7.3 и §8 — там же расхождение
в имени: возможно `uploadFileProgress`).

Метода «отметить прочитанным» отдельно нет: прочтение = подтверждение уведомления.
Метода поиска пользователей/списка контактов нет (только `getUserDisplayName` и участники чата).

### 6.2. Сообщения: `sendMessage`

```json
{
  "type": 1,
  "id": 1,
  "method": "sendMessage",
  "payload": {
    "chatId": "c8c3eee8-9ad0-4638-9692-ad16391a4256",
    "content": {
      "text": "Hello, world!",
      "parseMode": "text"
    }
  }
}
```

| Поле payload | Тип | Обяз. | Смысл |
| --- | --- | --- | --- |
| `chatId` | string | да | идентификатор чата |
| `replyMessageId` | string | нет | id сообщения, на которое отвечаем |
| `content.text` | string | да | текст |
| `content.parseMode` | string | да | `text` \| `markdown` \| `html` |
| `content.buttons` | array[][] | нет | inline-кнопки, только для ботов и только для `type 200` (5.5.6+) |

> **Расхождение.** Таблица параметров в документации перечисляет `text` и `parseMode` как поля
> `payload` (плоско), а все примеры — и примеры `editMessage`/`sendFile`/`sendSurvey` — используют
> вложенный `content`. Реализация библиотеки тоже собирает `content`.
> **Канон: `content: { text, parseMode }`.**

Ответ:

```json
{
  "type": 2,
  "id": 1,
  "payload": {
    "chatId": "c8c3eee8-9ad0-4638-9692-ad16391a4256",
    "messageId": "8fe61d87-6db0-4792-8f5e-e5960c7d5a06",
    "timestamp": 1735314170572
  }
}
```

`messageId` затем используется в `editMessage`, `forwardMessage`, `removeMessage`, `replyMessageId`.

Ответ на сообщение — тот же `sendMessage` с `replyMessageId`:

```json
{
  "type": 1,
  "id": 1,
  "method": "sendMessage",
  "payload": {
    "chatId": "c8c3eee8-9ad0-4638-9692-ad16391a4256",
    "replyMessageId": "3d968a21-543c-4fb2-9d8e-e31e3fbb35eb",
    "content": { "text": "Hello, world!", "parseMode": "text" }
  }
}
```

Форматирование (`formatting`): `parseMode` = `text` (всё экранируется), `markdown`, `html`.

| Стиль | Markdown | HTML |
| --- | --- | --- |
| жирный | `**текст**` | `<b>` |
| курсив | `*текст*` / `_текст_` | `<i>` |
| подчёркнутый (5.5.6+) | `__текст__` | `<u>` |
| зачёркнутый | `~~текст~~` | `<s>` |
| ссылка | `[текст](https://url)` | `<a href="https://url">` |
| перенос строки | `\n` | `<br>` (в html `\n` → пробел) |
| ответ цитатой (5.5.6+) | `>текст\n\nответ` | `<quote class="reply">текст</quote><br><br>ответ` |
| упоминание (5.5.3+) | `[John](trueconf:john_doe@d.com)` | `<a href="trueconf:john_doe@d.com">John</a>` |

Ограничения форматирования: с 5.5.6 `__жирный__` больше не жирный (только подчёркивание);
цитата отображается, только если задан `replyMessageId` и цитата стоит в начале;
неподдерживаемые теги и атрибуты вырезаются.

### 6.3. Inline-кнопки (5.5.6+)

Передаются в `content.buttons` — массив рядов, каждый ряд — массив кнопок.

Типы (`type`): `message`, `url`, `copy`, `command`. Общие поля: `id` (опционально), `label`
(до 32 Unicode-символов), `style` (`primary` \| `danger` \| `success`).

| Тип | Обязательные поля | Поведение |
| --- | --- | --- |
| `message` | `message`; опц. `draft` | отправить сообщение от имени пользователя; `draft: true` — вставить в поле ввода |
| `url` | `url` (8–8095 ASCII, `http://`, `https://`, `mailto:`, `trueconf:`) | открыть ссылку |
| `copy` | `data` (1–4095 Unicode) | скопировать в буфер |
| `command` | `command` (1–255 ASCII); опц. `customData` (до 4096 ASCII), `waitReply`, `to` | отправить команду боту без публикации сообщения |

```json
{
  "method": "sendMessage",
  "id": 7,
  "type": 1,
  "payload": {
    "chatId": "187f82e38567242a0ff266e022ffe2fc5ad24e1e",
    "content": {
      "text": "Привет! Я бот с кнопками.",
      "parseMode": "text",
      "buttons": [
        [
          { "type": "command", "label": "Отправь команду!", "command": "my_awesome_command", "waitReply": false },
          { "type": "command", "id": "button_98", "label": "🛒 Добавить товар", "command": "add_to_cart",
            "waitReply": true, "customData": "eyBwcm9kdWN0SWQgOiAiMHIyZmozamY5ajM5MyIgfQ==" },
          { "type": "url", "label": "Открыть сайт", "url": "https://trueconf.com", "style": "primary" }
        ],
        [
          { "type": "copy", "label": "Скопировать промокод", "data": "PROMO-12345", "style": "danger" },
          { "type": "message", "label": "Написать приветствие", "message": "Привет, коллеги!", "draft": false }
        ]
      ]
    }
  }
}
```

Лимиты: ≤ 64 кнопок, ≤ 8 рядов по 8; label ≤ 32 символа; HTML/Markdown в label не обрабатывается;
`\n` → пробел; некорректная кнопка не отображается. Изменение набора кнопок — через `editMessage`.

Нажатие кнопки `command` приходит уведомлением `command` (см. §8.2), ответ на команду с `waitReply: true`
отправляется методом `answerCommand` (см. §6.14).

### 6.4. `editMessage`

```json
{
  "type": 1, "id": 1, "method": "editMessage",
  "payload": {
    "messageId": "8fe61d87-6db0-4792-8f5e-e5960c7d5a06",
    "content": { "text": "Hello, world (edited)!", "parseMode": "text" }
  }
}
```

Ответ: `{ "messageId": "...", "timestamp": 1735314170572 }`.

### 6.5. `forwardMessage`

```json
{
  "type": 1, "id": 1, "method": "forwardMessage",
  "payload": { "chatId": "<куда>", "messageId": "<что пересылаем>" }
}
```

Ответ: `{ "chatId": "<куда>", "messageId": "<id нового сообщения>", "timestamp": ... }`.

### 6.6. `removeMessage`

```json
{
  "type": 1, "id": 1, "method": "removeMessage",
  "payload": { "messageId": "8fe61d87-...", "forAll": true }
}
```

`forAll` обязателен: `true` — удалить у всех. Ответ: `payload: {}`.

### 6.7. `getMessageById`

```json
{ "type": 1, "id": 1, "method": "getMessageById", "payload": { "messageId": "8fe61d87-..." } }
```

Ответ — Envelope в `payload` (включая `chat`, `replyMessage`, `box`, `isEdited`). Пример из документации:

```json
{
  "id": 2, "type": 2,
  "payload": {
    "chat": { "chatId": "db445c1cf948976c98fd71633d968697fcab9d2f", "chatTitle": "Коллеги", "chatType": 2 },
    "chatId": "db445c1cf948976c98fd71633d968697fcab9d2f",
    "messageId": "85c4005b-25d7-407a-8b1c-c6a74cc993ca",
    "timestamp": 1790634261078,
    "author": { "id": "danilov@video.example.net", "type": 1 },
    "replyMessageId": "eaa7a0ef-cbb7-46f1-ba80-b17e7eab80a7",
    "replyMessage": { "...": "Envelope исходного сообщения" },
    "box": { "id": 11, "position": "0" },
    "type": 200,
    "content": { "text": "ответ коллегам", "parseMode": "html" },
    "isEdited": true
  }
}
```

### 6.8. Чаты: создание

`createP2PChat` — личный чат. Если бот уже писал этому пользователю, вернётся существующий чат.

```json
{ "type": 1, "id": 1, "method": "createP2PChat", "payload": { "userId": "user@video.example.com" } }
```
```json
{ "type": 2, "id": 1, "payload": { "chatId": "4a1f88f1070d2f43d385cde9ff61964bc6b74477" } }
```

`createGroupChat` / `createChannel` — принимают только `title`:

```json
{ "type": 1, "id": 1, "method": "createGroupChat", "payload": { "title": "TrueConf Server Administrators’ Chat" } }
{ "type": 1, "id": 1, "method": "createChannel",  "payload": { "title": "Company news" } }
```

Ответ в обоих случаях — `{ "chatId": "..." }`.

`createFavoritesChat` (5.5.2+) — без payload:

```json
{ "type": 1, "id": 1, "method": "createFavoritesChat" }
```

Ответ — `{ "chatId": "..." }`.

Участники при создании группового чата/канала **не передаются** — их добавляют отдельно
`addChatParticipant`.

### 6.9. Чаты: изменение и удаление

`removeChat` — удаляет чат (личный, групповой, канал) для всех:

```json
{ "type": 1, "id": 1, "method": "removeChat", "payload": { "chatId": "c8c3eee8-..." } }
```
Ответ: `{ "chatId": "..." }`.

`editChatTitle` (5.5.3+):

```json
{ "type": 1, "id": 1, "method": "editChatTitle", "payload": { "chatId": "...", "title": "New title" } }
```
Ответ: `{ "chatId": "...", "timestamp": 1765115572804 }`.

`editChatAvatar` (5.5.3+):

```json
{
  "type": 1, "id": 1, "method": "editChatAvatar",
  "payload": { "chatId": "...", "temporalFileId": "8157ea50-fd9e-4b27-bb93-d9045bc65c48" }
}
```

`temporalFileId` — id файла, загруженного по HTTP (§7). Для удаления аватара — `null`.
**Ответ для `editChatAvatar` в документации не приведён** — **НЕ ПОДТВЕРЖДЕНО**
(вероятно пустой `payload`, как у `addChatParticipant`).

`clearHistory` (5.5.3+):

```json
{ "type": 1, "id": 1, "method": "clearHistory", "payload": { "chatId": "...", "forAll": false } }
```
`forAll` опционален (по умолчанию `false`); `true` требует прав в групповом чате/канале.
Ответ: `payload: {}`.

### 6.10. Чаты: чтение

`getChatHistory` — от нового к старому:

```json
{
  "type": 1, "id": 1, "method": "getChatHistory",
  "payload": { "chatId": "4a1f88f1...", "count": 9999, "fromMessageId": "e37cfc52-..." }
}
```

| Поле | Обяз. | Смысл |
| --- | --- | --- |
| `chatId` | да | чат |
| `count` | да | сколько вернуть |
| `fromMessageId` | нет | с какого сообщения начинать |

Ответ: `{ "chatId", "count", "messages": [Envelope, ...] }` (порядок — от нового к старому).

> Практическая деталь (release notes библиотеки 1.5.4): `fromMessageId: null` вызывает ошибку
> сервера `399 WRONG_PAYLOAD_FORMAT` — поле нужно **не передавать вовсе**, а не передавать `null`.
> Максимальный `count` в документации не указан (**НЕ ПОДТВЕРЖДЕНО**); в примерах — `9999`.

`getChatByID` (именно такое написание, с большой `ID`):

```json
{ "type": 1, "id": 1, "method": "getChatByID", "payload": { "chatId": "2b896a6e..." } }
```

Ответ:

```json
{
  "type": 2, "id": 1,
  "payload": {
    "chatId": "2b896a6ef210d6b2dcaebc2186c9a7974d616054",
    "title": "TrueConf Server Administrators’ Chat",
    "chatType": 2,
    "avatarUrl": "",
    "unreadMessages": 0,
    "lastMessage": {
      "messageId": "267d61f2-2ba1-4e88-83ab-bb84415f31b6",
      "timestamp": 1746028006345,
      "author": { "id": "brown@video.example.com", "type": 1 },
      "type": 200,
      "content": { "text": "What's up?", "parseMode": "html" }
    }
  }
}
```

`lastMessage` — Envelope **без** `chatId`, `isEdited` и `box`.

`getChats` — пейджинг, оба поля обязательны:

```json
{ "type": 1, "id": 1, "method": "getChats", "payload": { "count": 10, "page": 1 } }
```

`count` — максимум объектов в ответе, `page` — номер страницы, **начинается с 1**.
Ответ — `payload` это **массив** чатов (не объект):

```json
{
  "type": 2, "id": 1,
  "payload": [
    { "chatId": "...", "title": "...", "chatType": 2, "unreadMessages": 0, "lastMessage": { "...": "Envelope без chatId/isEdited/box" } },
    { "chatId": "...", "title": "chester@video.example.com", "chatType": 1, "unreadMessages": 1, "lastMessage": { "...": "" } }
  ]
}
```

### 6.11. Участники

`addChatParticipant` (только групповой чат и канал, нужны права):

```json
{
  "type": 1, "id": 1, "method": "addChatParticipant",
  "payload": { "chatId": "...", "userId": "user@video.example.com", "displayHistory": false }
}
```
`displayHistory` (5.5.3+) — показывать ли новому участнику старые сообщения. Ответ: `payload: {}`.

`removeChatParticipant`:

```json
{
  "type": 1, "id": 1, "method": "removeChatParticipant",
  "payload": { "chatId": "...", "userId": "user@video.example.com", "clearHistory": false }
}
```
`clearHistory` (5.5.3+) — по умолчанию `false`. Ответ: `payload: {}`.

`changeParticipantRole` (5.5.2+):

```json
{
  "type": 1, "id": 1, "method": "changeParticipantRole",
  "payload": { "chatId": "...", "userId": "user@video.example.com", "role": "admin" }
}
```
Ответ: `payload: {}`. Значения `role` — `ChatParticipantRoleEnum` (§9).

`getChatParticipant` (5.5.3+):

```json
{ "type": 1, "id": 1, "method": "getChatParticipant", "payload": { "chatId": "...", "userId": "user@video.example.com" } }
```
Ответ: `{ "userId": "...", "role": "user", "type": 1 }` (`type` — тип пользователя/автора).

`getChatParticipants`:

```json
{
  "type": 1, "id": 1, "method": "getChatParticipants",
  "payload": { "chatId": "...", "pageSize": 100, "pageNumber": 1 }
}
```

Ответ: `{ "participants": [ { "userId": "...", "role": "user", "type": 1 }, ... ] }`.

> Документация: «`pageNumber` — смещение, `startOffset = pageSize * pageNumber`». При этом в примере
> `pageNumber: 1`. Какая нумерация (0- или 1-based) — **НЕ ПОДТВЕРЖДЕНО**.

`hasChatParticipant` (deprecated с 5.5.3 → `getChatParticipant`):

```json
{ "type": 1, "id": 1, "method": "hasChatParticipant", "payload": { "chatId": "...", "userId": "..." } }
```
Ответ: `{ "result": true }`.

### 6.12. Активность бота

```json
{ "method": "sendChatActivity", "type": 1, "id": 10,
  "payload": { "chatId": "8be515432414d2e1385abec747ed4fb10cdb12f2", "activityType": "typing" } }
```

Ответ:

```json
{ "type": 2, "id": 10,
  "payload": { "chatId": "...", "activityType": "typing", "retryAfter": 5 } }
```

`retryAfter` — сколько секунд подождать перед следующей активностью (`0` — без ограничений).
Это **единственный документированный rate limit** в API. Значения `activityType`: `typing`,
`choosing_sticker`, `recording_audio`, `recording_video`, `uploading_file`.

### 6.13. Контакты

```json
{ "type": 1, "id": 1, "method": "getUserDisplayName", "payload": { "userId": "user@video.example.com" } }
```
Ответ: `{ "displayName": "John Doe" }`.

### 6.14. Ответ на команду кнопки

```json
{
  "method": "answerCommand", "id": 13, "type": 1,
  "payload": {
    "commandId": "89cbb2d1-e173-4833-87d1-8da7d98fda34",
    "answerType": "complete",
    "message": { "status": "ok", "visibility": "alert", "level": "info", "text": "Hakuna Matata!" }
  }
}
```

| Поле | Обяз. | Значения |
| --- | --- | --- |
| `commandId` | да | из уведомления `command` |
| `answerType` | да | `complete`, `timeout`, `cancel`, `message` |
| `message.status` | нет | `unknown`, `pending`, `running`, `ok`, `failed`, `canceled`, `timeout` |
| `message.visibility` | нет | `default`, `toast`, `sticky`, `alert` |
| `message.level` | нет | `info`, `warning`, `error`, `critical` |
| `message.text` | да (если есть `message`) | 1–255 ASCII |

Отображение `visibility: "alert"` требует поддержки клиентского приложения.
Ответ на запрос — стандартный `type: 2`.

> Важно для планирования: в библиотеке 1.5.5 `answerCommand` **намеренно бросает
> `NotImplementedError`** — «функциональность поддерживается сервером, но ожидает поддержки
> клиентскими приложениями». То есть цепочка `waitReply` на практике пока не рабочая.
> Помечаю как **НЕ ПОДТВЕРЖДЕНО** для реальных клиентов (сам протокол описан).

---

## 7. Файлы

### 7.1. Отправка файла — три шага

**Шаг 1. `uploadFile`** — создать задачу загрузки:

```json
{ "type": 1, "id": 5, "method": "uploadFile", "payload": { "fileSize": 1487, "fileName": "example.png" } }
```
Ответ: `{ "uploadTaskId": "2e9537c4-e82c-467c-a149-3c1b41326def" }`.
`fileName` — с 5.5.3. Если размер/расширение не проходят по лимитам администратора — ошибка (310
до 5.5.6, конкретные 400–408 с 5.5.6).

**Шаг 2. HTTP POST в хранилище** (единственный «не-WS» вызов, кроме токена):

```http
POST /bridge/api/client/v1/files HTTP/1.1
Upload-Task-Id: 2e9537c4-e82c-467c-a149-3c1b41326def
Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryQeFqWQPxCmHvCIyc

------WebKitFormBoundaryQeFqWQPxCmHvCIyc
Content-Disposition: form-data; name="file"; filename="some_image.png"
Content-Type: image/png

<file binary data>
------WebKitFormBoundaryQeFqWQPxCmHvCIyc
Content-Disposition: form-data; name="preview"; filename="d970f81f-...-d33c59b96cd5"
Content-Type: image/webp

<preview binary data>
------WebKitFormBoundaryQeFqWQPxCmHvCIyc--
```

* `Upload-Task-Id` — **HTTP-заголовок**, не query-параметр и не часть тела.
* Обязательное поле формы — `file`; имя файла из `Content-Disposition` **игнорируется**
  (сервер берёт `fileName` из `uploadFile`).
* Опциональное поле `preview` — превью (имя должно отличаться от основного файла).
* Стикеры с прозрачным фоном: для поля `file` указать `Content-Type: sticker/webp`.
* Никакого `Authorization`-заголовка документация не требует; библиотека тоже отправляет
  только `Upload-Task-Id` (`trueconf/client/bot.py`, метод загрузки). **НЕ ПОДТВЕРЖДЕНО**,
  что токен не нужен при включённых ограничениях безопасности — проверять на стенде.

Успех — **200 OK**:

```json
{ "temporalFileId": "2e9537c4-e82c-467c-a149-3c1b41326def" }
```

Ошибка — **400 Bad Request** с `{"error": 310, "error_description": "No upload task ID provided"}`.
`temporalFileId` годен только для отправки сообщения; после отправки «теряет свойства».

**Шаг 3. `sendFile`** — отправить сообщение с файлом:

```json
{
  "type": 1, "id": 6, "method": "sendFile",
  "payload": {
    "chatId": "bea15543d971a83c8ba1f103104791762c6b4b8f",
    "content": {
      "temporalFileId": "32506b12-6a1a-4cd3-be24-373c7bcf9510",
      "caption": { "text": "Here is your <i>file</i>!", "parseMode": "html" }
    }
  }
}
```

| Поле | Обяз. | Смысл |
| --- | --- | --- |
| `chatId` | да | чат |
| `content.temporalFileId` | да | из шага 2 |
| `content.caption.text` | нет | подпись (5.5.2+) |
| `content.caption.parseMode` | нет | режим форматирования подписи |
| `replyMessageId` | нет | ответ на сообщение — подтверждено реализацией библиотеки (`send_file.py`) |

Ответ:

```json
{
  "type": 2, "id": 6,
  "payload": {
    "chatId": "bea15543d971a83c8ba1f103104791762c6b4b8f",
    "timestamp": 1735134222098,
    "messageId": "c8c3eee8-9ad0-4638-9692-ad16391a4256",
    "fileId": "e09dbd63a16bd8cd7bddda7193c1c4ff0d2f6de5"
  }
}
```

`fileId` — постоянный id файла (для `getFileInfo`).

> **Расхождение.** Таблица документации перечисляет `temporalFileId`, `text`, `parseMode` как
> плоские поля payload; пример и библиотека используют `content.temporalFileId` +
> `content.caption.{text,parseMode}`. **Канон — вложенная форма.**
>
> Дополнительно: release notes библиотеки 1.5.0 упоминает в ответе `sendFile` поле
> `captionMessageId` (id отдельного сообщения с подписью). В документации API его нет —
> **НЕ ПОДТВЕРЖДЕНО** документацией, но наблюдается в реализации (5.5.6+).

### 7.2. Скачивание

**Шаг 1. `getFileInfo`**:

```json
{ "method": "getFileInfo", "id": 1, "type": 1, "payload": { "fileId": "e09dbd63a16bd8cd7bddda7193c1c4ff0d2f6de5" } }
```

Ответ:

```json
{
  "id": 2, "type": 2,
  "payload": {
    "fileId": "dd11ab35591d6c93216c9818187417c093686219",
    "name": "image_2025.11.01_17-15-15.webp",
    "size": 146362,
    "mimeType": "image/webp",
    "downloadUrl": "https://video.example.com/bridge/api/client/v1/files/dd11ab35591d6c93216c9818187417c093686219",
    "readyState": 2,
    "previews": [
      { "name": "preview-44f047a3ef51d19e06ce560d6c78a06b.webp", "size": 1200, "mimeType": "image/webp",
        "downloadUrl": "https://video.example.com/bridge/api/client/v1/files/dd11ab35591d6c93216c9818187417c093686219/preview/" }
    ]
  }
}
```

`readyState` — `FileReadyStateEnum`: `0` NOT_AVAILABLE (удалён по квоте/сроку), `1` UPLOADING,
`2` READY. `fileId` в ответе — с 5.5.4; `infoHash` — удалён в 5.5.4 (использовать `fileId`).

**Шаг 2.** `GET` на `downloadUrl` (превью — на `previews[].downloadUrl`).
Схема URL: `/bridge/api/client/v1/files/{fileId}` и `.../files/{fileId}/preview/`.
Нужен ли токен на этом GET — в документации не сказано (**НЕ ПОДТВЕРЖДЕНО**; библиотека качает без него).

### 7.3. Прогресс загрузки

Документация (`files`): событие о файле приходит **сразу при создании сообщения**, ещё до фактической
загрузки; файл становится доступен для скачивания позже.

`subscribeFileProgress` / `unsubscribeFileProgress`:

```json
{ "method": "subscribeFileProgress", "id": 10, "type": 1, "payload": { "fileId": "e09dbd63..." } }
```
Ответ: `{ "result": true }` (аналогично для unsubscribe).

События — `uploadingProgress`:

```json
{ "id": 3, "type": 1, "method": "uploadingProgress",
  "payload": { "fileId": "e09dbd63...", "progress": 123 } }
```

`progress` — **количество байт**, уже загруженных на сервер (не проценты). Когда `progress == size`
из `getFileInfo`, файл готов. Если файл уже был загружен — придёт одно финальное событие.

> **Расхождение (важно).** Документация называет событие `uploadingProgress`, а перечисление
> библиотеки `IncomingUpdateMethod` — `uploadFileProgress`. Возможно, поддержаны оба или
> документация устарела. **НЕ ПОДТВЕРЖДЕНО** — в ноде разбирать оба имени.

### 7.4. Лимиты хранилища

`getFileUploadLimits` (5.5.3+) — запрос без payload:

```json
{ "type": 1, "id": 1, "method": "getFileUploadLimits" }
```

Ответ:

```json
{
  "id": 1, "type": 2,
  "payload": {
    "maxSize": 2000000000,
    "extensions": { "mode": "block", "list": ["bas", "bat", "chm", "cmd"] }
  }
}
```

`maxSize` — байты (в документации странная ремарка «1 МБ = 1000 Б»; в примере 2 000 000 000);
`null` — ограничение отключено. `extensions.mode`: `block` (чёрный список) \| `allow` (белый);
`list` — расширения.

То же событие сервер присылает **при авторизации и при каждом изменении настроек** (см. §8.8).

> **Расхождение по версиям.** Документация API помечает `getFileUploadLimits` как 5.5.3+,
> а docs библиотеки (`learn/files.md`) пишет, что администратор может задавать лимиты
> «начиная с 5.5.2». Вероятно, лимиты появились в 5.5.2, а метод их чтения — в 5.5.3.
> **НЕ ПОДТВЕРЖДЕНО.**

### 7.5. Опросы

`sendSurvey` — отправляет **уже созданный** опрос. Опрос создаётся в личном кабинете сервера,
в клиенте Труконф или через API v4 (5.5.3+).

```json
{
  "type": 1, "id": 5, "method": "sendSurvey",
  "payload": {
    "chatId": "5abba630dd1089090ba41c69c7aa34e4ba277a43",
    "replyMessageId": "267d61f2-2ba1-4e88-83ab-bb84415f31b6",
    "content": {
      "url": "https://server.url/webtools/survey",
      "appVersion": 1,
      "path": "employee_testing",
      "title": "Employee survey",
      "description": "{{Survey}}",
      "buttonText": "{{Go to survey}}",
      "secret": "25690753a489f037af09b5cbce417b41374807fe",
      "alt": "📊 <a href='https://server.url/webtools/survey?id=employee_testing&error=autologin_not_supported'>Employee survey</a>"
    }
  }
}
```

| Поле content | Обяз. | Смысл |
| --- | --- | --- |
| `url` | да | `https://<server>/webtools/survey` |
| `appVersion` | да | версия опросов на сервере (в примерах `1`) |
| `path` | да | идентификатор кампании опроса |
| `title` | да | название |
| `description` | да | всегда `{{Survey}}` либо `{{Anonymous survey}}` |
| `buttonText` | да | всегда `{{Go to survey}}` |
| `secret` | да | SHA1 от конкатенации названия опроса и произвольной строки |
| `alt` | да | `📊 <a href="<url>?id=<path>"><title></a>` |

Ответ: `{ "timestamp", "messageId", "chatId" }`.

`editSurvey` — меняет `path`/`title`/`description`/`buttonText`/`alt` у сообщения `messageId`
(без `url`/`secret`/`appVersion`). Ответ: `{ "messageId", "timestamp" }`.

> Библиотека (`send_survey.py`) всегда передаёт `replyMessageId`, даже `null`. Учитывая
> историю с `fromMessageId: null` → `399`, лучше **не передавать** поле, если ответа нет.
> **НЕ ПОДТВЕРЖДЕНО**, что `null` здесь ломает запрос.

---

## 8. Исходящие события сервера

Формат — тот же конверт, но `method` инициирует сервер:
`{ "method": "<имя>", "type": 1, "id": <N>, "payload": {...} }`.
**На каждое событие клиент обязан ответить** `{"type":2,"id":<N>}` (иначе соединение закроется
через 300 с).

### 8.1. `sendMessage` — новое сообщение (главное событие)

`payload` — Envelope. `type` контента определяет, что именно пришло.

```json
{
  "method": "sendMessage", "type": 1, "id": 5,
  "payload": {
    "chat": { "chatId": "db445c1cf948976c98fd71633d968697fcab9d2f", "chatTitle": "Коллеги", "chatType": 2 },
    "chatId": "db445c1cf948976c98fd71633d968697fcab9d2f",
    "messageId": "c0ed3cc2-eccf-4e4f-9b0a-a242794d3ff3",
    "timestamp": 1790634293677,
    "author": { "id": "danilov@video.example.net", "type": 1 },
    "box": { "id": 12, "position": "0" },
    "type": 200,
    "content": { "text": "Привет!", "parseMode": "html" },
    "isEdited": false
  }
}
```

Варианты того же события по типам контента:

* `type: 200` — текст (`content.text`, `content.parseMode`, опц. `content.buttons`).
* `type: 201` — пересылка: `content` = вложенный Envelope **без** `box` (вложенность исторически 1 уровень).
* `type: 202` — файл: `content = { name, mimeType, size, fileId }` (готовность файла — позже, см. §7.3).
* `type: 203` — геолокация: `{ latitude, longitude, title }`.
* `type: 204` — опрос: `{ url, appVersion, path, title, description, buttonText, secret, alt }`.
* `type: 205` — голосовое (5.5.6+): `{ mimeType, fileId, size, duration }`.
* `type < 200` — системные сообщения (см. §8.9).

Ответ на сообщение приходит как `sendMessage` с `replyMessage` (5.5.6+) и `replyMessageId`.

### 8.2. `command` — нажатие inline-кнопки

```json
{
  "method": "command", "id": 12, "type": 1,
  "payload": {
    "commandId": "89cbb2d1-e173-4833-87d1-8da7d98fda34",
    "commandSource": {
      "type": "inlineKeyboard",
      "message": { "...": "Envelope сообщения с кнопкой" }
    },
    "commandPayload": {
      "type": "userCommand",
      "command": "add_to_cart",
      "customData": "eyBwcm9kdWN0SWQgOiAiMHIyZmozamY5ajM5MyIgfQ=="
    }
  }
}
```

`commandId` присутствует **только** если у кнопки `waitReply: true` (тогда нужен `answerCommand`).
`commandSource.type` — `"inlineKeyboard"`; `commandPayload.type` — `"userCommand"`.

### 8.3. `createP2PChat` / `createGroupChat` / `createChannel` / `createFavoritesChat`

Уведомление о новом чате, в который добавлен бот:

```json
{
  "method": "createGroupChat", "type": 1, "id": 14,
  "payload": {
    "chatId": "08d5dbda94a9de4b7554e3b4355307f9e97ffdb7",
    "title": "Marketing",
    "chatType": 2,
    "lastMessage": {
      "chatId": "08d5dbda94a9de4b7554e3b4355307f9e97ffdb7",
      "messageId": "cccea4a7-24b4-4b2c-8c50-67d01bce17bf",
      "timestamp": 1746029638147,
      "author": { "id": "user@video.example.com", "type": 0 },
      "type": 110,
      "content": { "userId": "bot@video.example.com", "role": "user" }
    },
    "unreadMessages": 2
  }
}
```

* `createP2PChat` — `title` = TrueConf ID собеседника, `chatType: 1`.
* `createChannel` — `chatType: 6`.
* `createFavoritesChat` (5.5.2+) — `title: null`, `chatType: 5`, `lastMessage: null`, `unreadMessages: 0`.

### 8.4. `editMessage` / `removeMessage`

`editMessage`:

```json
{
  "method": "editMessage", "type": 1, "id": 12,
  "payload": {
    "chatId": "d0b99ed24d6fb440a99fb12c4face5e5b28c3863",
    "messageId": "d4d20b4f-e4a4-4abc-8e66-ff2e17f483b7",
    "timestamp": 1746029430000,
    "content": { "text": "🤝", "parseMode": "html" }
  }
}
```

`removeMessage`:

```json
{
  "method": "removeMessage", "type": 1, "id": 12,
  "payload": {
    "chatId": "bd05af54347e04a1c44e70033d35834d4428bb5d",
    "messageId": "d4d20b4f-e4a4-4abc-8e66-ff2e17f483b7",
    "removedBy": { "id": "brown@video.example.com", "type": 1 }
  }
}
```

### 8.5. Участники: `addChatParticipant` / `removeChatParticipant` / `changeParticipantRole`

```json
{
  "method": "addChatParticipant", "type": 1, "id": 1,
  "payload": {
    "chatId": "c8c3eee8-...", "userId": "user@video.example.com", "userRole": "owner",
    "addedBy": { "id": "admin@video.example.com", "type": 1 },
    "timestamp": "1735370776"
  }
}
```

```json
{
  "method": "removedChatParticipant", "type": 1, "id": 1,
  "payload": {
    "chatId": "c8c3eee8-...", "userId": "user@video.example.com",
    "removedBy": { "id": "admin@video.example.com", "type": 1 },
    "timestamp": "1735370778"
  }
}
```

```json
{
  "method": "changeParticipantRole", "type": 1, "id": 1,
  "payload": { "chatId": "...", "userId": "user@video.example.com", "role": "admin", "timestamp": 1760594447544 }
}
```

> **Расхождения.**
> 1. Событие удаления участника называется **`removedChatParticipant`**, а команда клиента —
>    `removeChatParticipant` (с `e`). Это не опечатка: так в документации (members) и так в
>    перечислении библиотеки. В ноде обрабатывать оба варианта написания.
> 2. `timestamp` в уведомлениях об участниках в примерах — **строка** (`"1735370776"`), хотя
>    в таблицах тип `uint64` и в других событиях это число. **НЕ ПОДТВЕРЖДЕНО**, всегда ли строка;
>    парсить и как строку, и как число. Значение в примере похоже на секунды, а не миллисекунды.
> 3. `userRole` в `addChatParticipant` описан как «роль пользователя, который **добавил** участника»
>    (5.5.2+) — то есть это роль актора, а не добавленного. В примере `userRole: "owner"` при
>    `addedBy = admin@...`. **НЕ ПОДТВЕРЖДЕНО**, чья это роль на самом деле.

### 8.6. Чат: `editChatTitle` / `editChatAvatar` / `clearHistory` / `removeChat`

```json
{ "method": "editChatTitle", "type": 1, "id": 1,
  "payload": { "chatId": "29bc6e4d0f99105b50f419eff03a1ed58da9db6c", "title": "New title" } }
```

```json
{ "method": "editChatAvatar", "type": 1, "id": 12,
  "payload": { "chatId": "af9d5017...", "avatarUrl": "http://10.110.2.241/bridge/api/client/v1/message/123657c5-.../preview" } }
```

`avatarUrl: null` — изображение удалено. Обратите внимание: URL в примере — `http://` и через
`/bridge/api/client/v1/message/<id>/preview` (эндпоинт превью *сообщения*, не файла).

```json
{ "type": 1, "id": 1, "method": "clearHistory", "payload": { "chatId": "c8c3eee8-...", "forAll": false } }
```

```json
{ "method": "removeChat", "type": 1, "id": 1, "payload": { "chatId": "84960c6d80afa729b0fd42d35331de5814cc3e9a" } }
```

### 8.7. Прочие события

* `uploadingProgress` (или `uploadFileProgress` — см. §7.3) — прогресс загрузки файла.
* `command` — нажатие кнопки (§8.2).
* `getFileUploadLimits` — сервер присылает актуальные лимиты хранилища при авторизации и при
  изменении настроек (§8.8).

### 8.8. `getFileUploadLimits` как событие

```json
{
  "id": 2, "type": 1, "method": "getFileUploadLimits",
  "payload": { "maxSize": 2000000000, "extensions": { "mode": "block", "list": ["bas","bat","chm","cmd"] } }
}
```

### 8.9. Системные сообщения (`sendMessage` с `type < 200`)

Приходят как обычные `sendMessage`, если `receiveSystemMessageEnvelopes` не выключен:

```json
{
  "method": "sendMessage", "type": 1, "id": 6,
  "payload": {
    "chatId": "0b88a6d4ff2f15ee9234f8871a88789b2ec645dd",
    "messageId": "49b35c1b-f570-4c0e-acdb-79b6e41b5afd",
    "timestamp": 1766057730627,
    "author": { "id": "john_doe@video.example.com", "type": 1 },
    "type": 1,
    "content": { "userId": "echo_bot@video.example.com", "role": "user" },
    "box": { "id": 9, "position": "0" }
  }
}
```

Это **только записи в историю чата** («подписи» к событиям), не факты действий: для действий есть
отдельные события (§8.3–8.5). В ноде системные сообщения надо либо отфильтровывать
(по `envelope.type < 200`), либо явно адресовать в отдельный выход триггера, чтобы они не
попадали в «пользовательские сообщения».

---

## 9. Перечисления

```ts
enum MESSAGE_TYPE { RESERVED = 0, REQUEST = 1, RESPONSE = 2 }

enum ChatTypeEnum { UNDEF = 0, P2P = 1, GROUP = 2, SYSTEM = 3, FAVORITES = 5, CHANNEL = 6 }

enum EnvelopeContentType {
  ADD_PARTICIPANT = 1, REMOVE_PARTICIPANT = 2,
  EDIT_CHAT_TITLE = 21, EDIT_CHAT_AVATAR = 22, CLEAR_CHAT_HISTORY = 23,
  PARTICIPANT_ROLE = 110,
  PLAIN_MESSAGE = 200, FORWARDED_MESSAGE = 201, ATTACHMENT = 202,
  GEOLOCATION = 203, SURVEY = 204, VOICE = 205
}

enum EnvelopeAuthorTypeEnum { SYSTEM = 0, USER = 1 }

enum ChatParticipantRoleEnum {
  OWNER = "owner", ADMIN = "admin", USER = "user",
  CONF_OWNER = "conf_owner", CONF_MODERATOR = "conf_moderator",
  FAVORITES_OWNER = "favorites_owner", WRITER = "writer"
}

enum TextParseModeEnum { TEXT = "text", MARKDOWN = "markdown", HTML = "html" }

enum ChatActivity { TYPING = "typing", CHOOSING_STICKER = "choosing_sticker",
  RECORDING_AUDIO = "recording_audio", RECORDING_VIDEO = "recording_video",
  UPLOADING_FILE = "uploading_file" }

enum FileReadyStateEnum { NOT_AVAILABLE = 0, UPLOADING = 1, READY = 2 }

enum OAUTH_ERROR { INVALID_REQUEST = "invalid_request", INVALID_CLIENT = "invalid_client",
  INVALID_GRANT = "invalid_grant", UNSUPORTED_GRANT_TYPE = "unsupported_grant_type" }
```

Примечание: `EnvelopeAuthorTypeEnum` в документации задан без явных чисел, но в JSON всюду
приходит число (`0` — сервер, `1` — пользователь), в том числе в `author.type` и `removedBy.type`.

---

## 10. Коды ошибок

Формат ошибки в WS: `{"type":2,"id":N,"payload":{"errorCode":<код>}}`.
HTTP-сервер, кроме статуса `400`, кладёт код в тело: `{"error": 310, "error_description": "..."}`.

### 10.1. Протокол

| Код | Имя | Описание |
| --- | --- | --- |
| 2 | `INVALID_REQUEST_ID` | `id` уже использован |
| 399 | `WRONG_PAYLOAD_FORMAT` | неверный формат `payload` |

### 10.2. Сеть

| Код | Имя | Описание |
| --- | --- | --- |
| 100 | `CONNECTION_ERROR` | ошибка соединения |
| 101 | `CONNECTION_TIMEOUT` | таймаут соединения |
| 102 | `TLS_ERROR` | ошибка TLS/SSL |
| 103 | `UNSUPPORTED_PROTOCOL` | неподдерживаемый протокол |
| 104 | `ROUTE_NOT_FOUND` | маршрут не найден |

### 10.3. Авторизация

| Код | Имя | Описание / что делать |
| --- | --- | --- |
| 200 | `NOT_AUTHORIZED` | не авторизован (не выполнен `auth`) |
| 201 | `INVALID_CREDENTIALS` | неверные учётные данные |
| 202 | `USER_DISABLED` | пользователь отключён |
| 203 | `CREDENTIALS_EXPIRED` | токен истёк → заново получить токен, переподключиться, `auth` |
| 204 | `UNSUPPORTED_CREDENTIALS` | неверный тип токена |

### 10.4. Чаты и сообщения

| Код | Имя | Описание |
| --- | --- | --- |
| 300 | `INTERNAL_ERROR` | внутренняя ошибка сервера |
| 301 | `TIMEOUT` | таймаут операции |
| 302 | `ACCESS_DENIED` | доступ запрещён |
| 303 | `NOT_ENOUGH_RIGHTS` | недостаточно прав |
| 304 | `CHAT_NOT_FOUND` | чат не найден |
| 305 | `USER_IS_NOT_CHAT_PARTICIPANT` | пользователь не участник чата |
| 306 | `MESSAGE_NOT_FOUND` | сообщение не найдено |
| 307 | `UNKNOWN_MESSAGE` | неизвестное сообщение |
| 308 | `FILE_NOT_FOUND` | файл не найден |
| 309 | `USER_IS_ALREADY_CHAT_PARTICIPANT` | уже состоит в чате |
| 310 | `FILE_UPLOAD_FAILED` | ошибка загрузки файла |
| 311 | `FILE_NOT_READY` | файл ещё не готов |
| 312 | `ROLE_NOT_FOUND` | роль не найдена |

### 10.5. Файловые (5.5.6+), уточняют 310

| Код | Имя | Описание |
| --- | --- | --- |
| 400 | `UNKNOWN` | неизвестная ошибка файла |
| 401 | `NOT_ENOUGH_SPACE` | недостаточно места |
| 402 | `BAD_FILE_NAME` | некорректное имя файла |
| 403 | `FILE_UPLOAD_FORBIDDEN` | загрузка запрещена |
| 404 | `FILE_NOT_FOUND` | файл не найден |
| 405 | `FILE_NOT_READY` | файл ещё не готов |
| 406 | `MAX_FILE_SIZE_EXCEEDED` | превышен максимальный размер |
| 407 | `UPLOAD_TASK_NOT_FOUND` | задача загрузки не найдена |
| 408 | `INVALID_FILE` | некорректный файл |

Обратите внимание: коды `400`–`408` используются и как HTTP-статусы, и как «файловые» коды
в теле — не путать контекст.

---

## 11. Лимиты (сводно)

| Лимит | Значение | Источник / статус |
| --- | --- | --- |
| Одновременных WebSocket-соединений на сервер | **128** (с 5.5.3) | подтверждено |
| Один JWT на несколько соединений | с 5.5.4 | подтверждено |
| Срок жизни JWT | 1 месяц; уже открытое соединение живёт до разрыва | подтверждено |
| Неподтверждённое уведомление → разрыв | **300 с** | подтверждено |
| Таймаут ответа на запрос | **300 с** (5 мин) | подтверждено |
| `receiveUnread`: сколько непрочитанных отдаётся | до **1000**, по одному, от старых к новым | подтверждено |
| Длина текста сообщения | **4096** видимых символов | только docs библиотеки (`learn/restrictions.md`); в API-документации не найдено — **НЕ ПОДТВЕРЖДЕНО сервером** |
| Длина названия чата | **255** символов | только docs библиотеки — **НЕ ПОДТВЕРЖДЕНО сервером** |
| `count` в `getChatHistory` | не документирован (в примере 9999) | **НЕ ПОДТВЕРЖДЕНО** |
| Кнопки | ≤ 64, ≤ 8 рядов по 8; `label` ≤ 32 Unicode; `command` 1–255 ASCII; `customData` 1–4096 ASCII; `url` 8–8095 ASCII; `copy.data` 1–4095 Unicode | подтверждено |
| Размер файла / расширения | задаёт администратор; читать `getFileUploadLimits` (`maxSize`, `extensions.mode/list`) | подтверждено (пример `maxSize` = 2000000000) |
| Частота «активности» (`sendChatActivity`) | `retryAfter` секунд из ответа | подтверждено |
| Частота сообщений | лимита в документации **нет** | — |

Отдельно: «128 соединений» — это лимит на сервер (и на выделенный сервер ботов при схеме
с федерацией), а не на бота. Схема с отдельным сервером ботов за федерацией рекомендуется
официально (изоляция учётных данных, свой лимит 128, независимое обслуживание).

---

## 12. Как создать/включить бота на сервере

**Что подтверждено документацией:**

* Бот — это **обычная учётная запись пользователя TrueConf Server** (Registry или LDAP),
  созданная администратором в разделе «Пользователи и группы».
  Никакого отдельного объекта «бот» в API Chatbot Connector нет.
* Гостевые учётные записи и пользователи других серверов (в т.ч. федеративных) для авторизации
  бота **не подходят**.
* Пароль должен быть задан (для способа A), либо на сервере создаётся OAuth 2.0-приложение
  с правом `version:read` (способ B, 5.5.3+).
* Для отправки в канал/групповой чат нужны права участника: набор прав по ролям описан в
  `roles-and-users-rules` (например, в канале отправлять сообщения могут `owner`, `admin`,
  `conf_owner`, `conf_moderator`, `favorites_owner`, `writer`, а `user` — **не может**).
  Писать боту в личный чат с пользователем можно без специальных прав.
* HTTP API сервера (REST v4, OAuth2-приложения) включён во всех редакциях, включая бесплатную
  (https://trueconf.ru/docs/server/ru/admin/api/).

**Чего в документации нет (важно):**

* Нет раздела админ-документации «чат-боты»: в оглавлении TrueConf Server есть «Чаты»
  (`/docs/server/ru/admin/chats/`), но там только таймаут редактирования сообщений и автоочистка
  пустых чатов конференций — про ботов ничего.
* **НЕ ПОДТВЕРЖДЕНО**, существует ли в панели управления флаг/тип учётной записи «бот».
  В админ-документации (страницы «Типы пользователей», «Пользователи и группы», «Расширения»)
  такого флага нет. Судя по всему, отдельный флаг не требуется — достаточно обычного пользователя.
  Перед публикацией ноды это стоит проверить на живом сервере (5.5.6 / 5.6.x).
* **НЕ ПОДТВЕРЖДЕНО**, нужны ли боту какие-то особые права Beyond «пользователь сервера»
  (например, право на создание чатов/каналов): в API-документации сказано лишь «требуются
  соответствующие права» без перечня.

Практическая инструкция для README ноды (по подтверждённым фактам):
1. Администратор создаёт пользователя, например `n8n_bot`, с паролем.
2. (Опционально) добавляет его в адресную книгу пользователей, чтобы люди могли писать боту.
3. Нода получает JWT: `POST /bridge/api/client/v1/oauth/token` с `client_id: "chat_bot"`.
4. Нода подключается к `wss://<server>/websocket/chat_bot/` и делает `auth`.
5. Чтобы бот мог писать первым — `createP2PChat` с `userId`, затем `sendMessage` с `chatId`.
6. В групповые чаты/каналы бота добавляют через `addChatParticipant` (нужны права) либо
   пользователь добавляет его сам в клиенте.

---

## 13. Расхождения, противоречия и открытые вопросы

Собрано специально, чтобы не «додумывать» при реализации.

| # | Вопрос | Статус |
| --- | --- | --- |
| 1 | Имя события прогресса загрузки: `uploadingProgress` (документация) vs `uploadFileProgress` (enum библиотеки) | **НЕ ПОДТВЕРЖДЕНО**; поддерживать оба |
| 2 | Плоские `text`/`parseMode`/`temporalFileId` в таблицах vs вложенный `content{}` в примерах | канон — `content{}` (примеры + библиотека) |
| 3 | Код ошибки неверного пароля на `/oauth/token`: `400 invalid_grant` (документация) vs `401` (библиотека); `403 auth_method_disabled` — только в библиотеке | **НЕ ПОДТВЕРЖДЕНО** |
| 4 | `client_id` на этапе 3 OAuth: логин бота (документация) vs литерал `"user"` (библиотека) | вероятная ошибка библиотеки; **НЕ ПОДТВЕРЖДЕНО** |
| 5 | `expires_at` (секунды, способ A) vs `expires_in` = момент истечения в **мс** (способы B, этапы 2–3) | подтверждено, что семантика разная — не перепутать |
| 6 | `answerCommand` / `waitReply: true`: протокол описан, но библиотека 1.5.5 бросает `NotImplementedError` (нет поддержки в клиентах) | **НЕ ПОДТВЕРЖДЕНО** на практике |
| 7 | Событие удаления участника: `removedChatParticipant` (сервер) vs команда `removeChatParticipant` | подтверждено, что написания разные |
| 8 | `timestamp` в событиях участников — строка (`"1735370776"`) вместо числа; похоже на секунды | **НЕ ПОДТВЕРЖДЕНО** |
| 9 | `userRole` в `addChatParticipant`: роль актора или добавленного? | **НЕ ПОДТВЕРЖДЕНО** |
| 10 | `pageNumber` в `getChatParticipants`: 0- или 1-based | **НЕ ПОДТВЕРЖДЕНО** |
| 11 | Ответ `editChatAvatar` (команда клиента) не показан | **НЕ ПОДТВЕРЖДЕНО** |
| 12 | Нужен ли токен на `GET downloadUrl` и `POST /bridge/api/client/v1/files` | **НЕ ПОДТВЕРЖДЕНО** (в документации заголовков авторизации нет) |
| 13 | `captionMessageId` в ответе `sendFile` — есть в библиотеке, нет в документации | **НЕ ПОДТВЕРЖДЕНО** |
| 14 | Лимиты 4096 символов / 255 символов названия — только в docs библиотеки | **НЕ ПОДТВЕРЖДЕНО** серверной валидацией |
| 15 | Флаг «бот» у учётной записи в панели управления | **НЕ ПОДТВЕРЖДЕНО**; в админ-документации такого нет |
| 16 | Сбрасывается ли счётчик `id` при переподключении (новое WS-соединение) | **НЕ ПОДТВЕРЖДЕНО**; безопасно продолжать монотонно в рамках процесса |
| 17 | Есть ли обязательный прикладной `ping` (кроме ответов на уведомления) | **НЕ ПОДТВЕРЖДЕНО**; сервер закрывает по отсутствию подтверждений |
| 18 | Максимум `count` в `getChatHistory` / `getChats` | **НЕ ПОДТВЕРЖДЕНО** |
| 19 | В вебинарном PDF Chatbot Connector токен назван «JWE», в документации — `token_type: "JWT"` | доверять документации (`JWT`) |
| 20 | `editChatAvatar` событие: `avatarUrl` ведёт на `/bridge/api/client/v1/message/<id>/preview`, а `getFileInfo` — на `/bridge/api/client/v1/files/<fileId>` | подтверждено, что эндпоинты разные |

---

## 14. Что это значит для n8n-ноды (следствия контракта)

Не часть API, но прямо следует из подтверждённых фактов:

1. **Транспорт — только WebSocket** для приёма. Webhook/polling сервер не поддерживает.
   Значит: нода-триггер должна держать постоянное соединение (single connection per bot),
   либо нужен отдельный «мост» (отдельный сервис), т.к. n8n-инстансов может быть несколько,
   а лимит — 128 соединений на сервер и один бот = одна сессия по смыслу (сообщения доставляются
   в сессию, `receiveUnread` только для offline-накопления).
2. **Обязательное подтверждение** каждого входящего `type: 1` (`{"type":2,"id":N}`) в течение 300 с.
   Если нода упадёт в обработке — соединение закроется; подтверждать нужно сразу при получении,
   а не после успешного выполнения workflow (иначе «прочитанность» тоже сдвигается).
3. **`id` монотонно растёт** и не повторяется: нужен собственный счётчик + корреляция ответов
   по `id` с таймаутом (5 мин на сервере, практически — секунды).
4. **Порядок сообщений** — по `box.id` + `box.position` (строкой по ASCII), а не по `timestamp`.
5. **Отправка**: `chatId` обязателен; для нового адресата — `createP2PChat(userId)` /
   `createGroupChat(title)` / `createChannel(title)`. То есть в UI ноды логично поле
   «чат или TrueConf ID пользователя» с автополучением/созданием `chatId` и кэшем.
6. **Файлы** — трёхшаговая схема (`uploadFile` → HTTP multipart → `sendFile`) с обязательным
   `temporalFileId`; одна HTTP-точка вне WS. Загрузка из n8n-бинаря потребует multipart с полем `file`.
7. **Форматирование** — `parseMode` (`text`/`markdown`/`html`); для n8n удобно дефолтить в `markdown`,
   с предупреждением про `__` (с 5.5.6 это подчёркивание, а не жирный) и про `\n` в html.
8. **Кнопки/`command`/`answerCommand`** — фича 5.5.6+, на практике не подтверждена со стороны клиентов;
   можно реализовать как «экспериментальное» поле.
9. **События**: минимум `sendMessage` (фильтр `type >= 200` для пользовательских), плюс
   `createP2PChat`/`createGroupChat`/`createChannel`, `addChatParticipant`/`removedChatParticipant`,
   `changeParticipantRole`, `editMessage`, `removeMessage`, `editChatTitle`, `editChatAvatar`,
   `clearHistory`, `removeChat`, `command`, `getFileUploadLimits`, `uploadingProgress`.
10. **Ошибки**: `200/203` → переавторизация; `2/399` → баг в формировании конверта;
    `303/304/305` → права/чат; `310`/`400–408` → файлы; HTTP 400/401 на токене → учётные данные.

---

## 15. Приложение: как перепроверить

* Полные HTML-копии всех 15 страниц документации: `docs/research/_raw/*.html`,
  извлечённый текст: `docs/research/_raw/txt/*.txt`, скрипт извлечения: `docs/research/_raw/extract.py`.
* Исходники библиотеки (методы, типы, enum'ы): `docs/research/_raw/gh/`,
  все `methods/*.py` — `docs/research/_raw/gh/methods_all/`.
* Админ-документация TrueConf Server (лицензирование, чаты, API, расширения):
  `docs/research/_raw/srv/*.html`.
* Страница цен TrueConf Server (подтверждение «APIs for … chatbots» в Free):
  `docs/research/_raw/pricing_en.html`.

Команда для повторного скачивания страниц документации — см. историю: `Invoke-WebRequest` по
15 слагам раздела `/docs/chatbot-connector/ru/<slug>/`.
