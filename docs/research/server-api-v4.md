# TrueConf Server API v4 — контракт для community-node n8n

> **Статус документа:** исследование по первоисточникам, 2026-11-15.
> **Метод:** спецификация получена не парсингом HTML, а напрямую — страница `https://trueconf.ru/docs/server-api/ru.html`
> оказалась обёрткой над [Scalar](https://scalar.com) API reference, которая загружает машиночитаемый OpenAPI 3.1
> документ. Именно эти YAML-файлы и являются первоисточником всех фактов ниже (скачаны и сохранены в `_src/`):
>
> * `https://trueconf.ru/docs/server-api/dist/v41_ru.yaml` (935 КБ) и `v41_en.yaml` (787 КБ) — **v4.1, актуальная**
> * `https://trueconf.ru/docs/server-api/dist/v4_ru.yaml` / `v4_en.yaml` — v4.0
>
> Спецификация v4.1: 273 пути, **393 операции**, 576 схем компонентов, 142 области прав (scope).
> Дополнительно использованы: руководство администратора `https://trueconf.ru/docs/server/ru/admin/api/`
> и документация Chatbot Connector `https://trueconf.ru/docs/chatbot-connector/ru/`.
>
> Всё, что не удалось подтвердить первоисточником, помечено **«НЕ ПОДТВЕРЖДЕНО»**.

---

## 0. TL;DR для разработчика ноды

| Параметр | Значение |
|---|---|
| База (v4.1) | `https://{host}/api/v4.1` |
| База (v4.0) | `https://{host}/api/v4` |
| Формат | JSON (`application/json`) |
| Авторизация | OAuth 2.0, `Authorization: Bearer <access_token>` |
| Токен | `POST /api/v4.1/oauth2/token`, grant `client_credentials` / `password` / `authorization_code` / `refresh_token` |
| TTL access | 3600 с (1 час) — по умолчанию |
| TTL refresh | 7 дней — по умолчанию |
| Минимальная версия сервера | **5.5.3** для v4, **5.5.6** для v4.1 |
| Free-версия | API доступен во **всех** версиях, включая бесплатную |
| Пагинация | `page`, `page_size`, `sort_field`, `sort_order` |
| Формат ошибки | `{code, message, trace_id, errors[]}` |
| Сообщения бота | ❌ в Server API v4 **нет** — это отдельный Chatbot Connector (WebSocket) |

---

## 1. Базовый URL, версия, формат, заголовки

### 1.1. Базовый URL

В OpenAPI-документе объявлен относительный сервер:

```yaml
servers:
  - url: api/v4.1        # для v4.0: api/v4
```

Пути внутри спецификации начинаются со `/`, поэтому полный адрес собирается как:

```
https://{host}/api/v4.1/users
https://{host}/api/v4.1/oauth2/token
```

`{host}` — IP-адрес или FQDN TrueConf Server (формулировка руководства: «IP address or FQDN address of your server»).
В официальном примере Chatbot Connector используется `video.example.net`, в примерах спецификации — `video.example.com`.

**Версия в пути — единственный способ выбрать версию API.** Все три версии (v4.0, v4.1) живут одновременно на одном
сервере, если он их поддерживает (см. §2).

**Схема:** HTTPS. HTTP-доступ к API явно не описан; для Chatbot Connector прямо сказано, что незашифрованные
HTTP/WS допустимы только локально. Для Server API считаем HTTPS обязательным на практике — **НЕ ПОДТВЕРЖДЕНО**
как жёсткое требование (в спеке нет `http`/`https`-ограничения).

### 1.2. Версия API

Версионирование — по префиксу пути: `api/v4`, `api/v4.1`. Внутри версии обратная совместимость: v4.1 полностью
включает v4.0 плюс три новых эндпоинта (см. §10).

Отдельного заголовка версии, `Accept-Version` или content-negotiation **нет**.

### 1.3. Заголовки

| Заголовок | Значение | Когда |
|---|---|---|
| `Authorization` | `Bearer {access_token}` | **всегда**, основной способ |
| `Content-Type` | `application/json` | POST / PATCH / PUT с телом |
| `Accept` | `application/json` | желательно |

Легаси-способ передачи токена (сохранён только для обратной совместимости, в новых интеграциях не использовать):

```
GET /api/v4.1/users?access_token={access_token}
```

Это зафиксировано в спецификации как альтернативная схема безопасности `QueryAuth` (`apiKey`, `in: query`,
`name: access_token`) рядом с основной `BearerAuth` (`type: http`, `scheme: bearer`).

> ⚠️ Для n8n-ноды реализуйте `Bearer`. Query-вариант можно не поддерживать вовсе — официально он не рекомендован.

### 1.4. Формат тела

* Запрос: JSON-объект. Для части эндпоинтов `Content-Type` в спеке указан как `*/*` — это не значит, что принимается
  что-то кроме JSON; в примерах везде JSON.
* Ответ: `application/json`, кроме особых случаев:
  * `GET /users-export` → `text/csv`;
  * `GET /conferences/{id}/recordings/{rid}/download` → файл;
  * `GET /users/{id}/avatar`, `GET /conferences/{id}/background/image` → изображение;
  * `GET /conferences/{id}/ics` → ICS-календарь.
* Пустое тело: `204 No Content` (111 операций из 393).

### 1.5. Коды успеха

| Код | Значений в спеке | Смысл |
|---|---|---|
| `200 OK` | 263 | есть тело ответа |
| `201 Created` | 1 | создание (slides) |
| `202 Accepted` | 13 | асинхронная операция (уведомления, invite, stop session) |
| `204 No Content` | 111 | успех без тела (удаление, run/stop, unban) |
| `302 Found` | 6 | только OAuth-редиректы |

---

## 2. Версии сервера, совместимость, Free-версия

### 2.1. Минимальные версии

Из вводной части спецификации (дословно):

> API v4+ is available starting with TrueConf Server version **5.5.3** and newer.

Таблица совместимости из спецификации (сокращённо — только строки, где появляется v4):

| TrueConf Server | Поддерживаемые версии API |
|---|---|
| 5.5.0 – 5.5.2 | v3 … v3.11 (v4 **нет**) |
| **5.5.3** | v3 … v3.11, **v4** |
| 5.5.4, 5.5.5 | v3 … v3.11, **v4** |
| **5.5.6** | v3.8 … v3.11, **v4, v4.1** |

Полная таблица начинается с версии 4.3.9 (API v1/v1.1/v2/v3) — в `_src/intro_v41.md`.

**Практический вывод для ноды:** целевая версия — **5.5.6+** (даёт v4.1). Если сервер 5.5.3–5.5.5 — доступен только
`/api/v4`. Рекомендуется делать версию настраиваемой (credential-поле «API version», по умолчанию `v4.1`) либо
определять автоматически через `GET /api/v4.1/product/version` с фолбэком на `/api/v4`.

### 2.2. Free-версия

Руководство администратора, дословно:

> The features of TrueConf Server can be extended with the RESTful API available in **all versions, including the free one**.

То есть **API v4 доступен в бесплатной версии TrueConf Server**. Ограничения Free касаются числа участников
конференции, а не самого API.

**НЕ ПОДТВЕРЖДЕНО:** зависит ли набор доступных *эндпоинтов* или *scope* от редакции лицензии (Free / PRO).
В спецификации такой зависимости нет — только от прав OAuth-приложения. Но фактически часть данных (например,
записи конференций, транскрибация) может отсутствовать на Free из-за отсутствия функции, а не из-за прав.

---

## 3. OAuth 2.0 — полный поток

### 3.1. Создание приложения (client_id / client_secret)

**Через панель управления:** раздел **API → OAuth2** → создать приложение. Заполняются:

1. **Name** — имя приложения (в API: `minLength: 8`, `maxLength: 128`).
2. **Redirect URL**:
   * для метода `authorization_code` — реальный URL возврата;
   * для **всех остальных** методов — обязательно `https://localhost/` (дословно из руководства).
3. **Grant types** — минимум один тип.
4. **Permissions** — набор прав (scope).

После создания выдаются:

| Поле | Свойства |
|---|---|
| `client_id` (Application ID) | создаётся автоматически, **изменить нельзя** |
| `client_secret` (Secret) | можно **перегенерировать**; `minLength: 40`, `maxLength: 255` |

> ⚠️ При перегенерации секрета **уже выданные** access- и refresh-токены остаются валидными до истечения своего
> срока. Блокировка приложения не отзывает выданные токены — для этого нужно удалять токены через
> `DELETE /oauth/access-tokens/{token_id}`.

**Через API** (нужно право `admin`):

```http
POST /api/v4.1/oauth/clients
Content-Type: application/json

{
  "name": "n8n integration",
  "redirect_uri": "https://localhost/",
  "scope": ["users:read", "users:write", "conferences:read", "conferences:write"],
  "grant_types": ["client_credentials"],
  "enabled": true,
  "access_token_ttl": 3600,
  "refresh_token_ttl": 604800,
  "auth_code_ttl": 300
}
```

Обязательные поля: `name`, `redirect_uri`, `scope`. Ответ — `{"client": {...}}` с `id` и `secret`.

> Полезно для ноды: можно автоматизировать провижининг приложения из n8n, если есть админский токен.

### 3.2. Grant types

Спецификация (`POST /oauth/clients`, `PATCH /oauth/clients/{id}`) объявляет enum из шести значений:

```
authorization_code | client_credentials | client_secretkey | password | refresh_token | trusted_password
```

Руководство администратора документирует четыре из них:

| Grant type | Scope токена | Нужна авторизация пользователя | Время жизни |
|---|---|---|---|
| **`client_credentials`** | **server-wide** (без привязки к пользователю) | нет | access **1 час** |
| **`password`** (Resource Owner Password Credentials) | ограничен видимостью пользователя | да (логин+пароль передаёт приложение) | access **1 час** + refresh **7 дней** |
| **`authorization_code`** | ограничен видимостью пользователя | да (ввод на стороне сервера, приложение пароля не видит) | access **1 час** + refresh **7 дней** |
| **`refresh_token`** | наследует scope пользователя | нет | новый access **1 час**, повторно не продлевается |

**`client_secretkey` и `trusted_password`** присутствуют в enum, но **не описаны** ни в руководстве, ни в
человекочитаемых разделах спецификации. **НЕ ПОДТВЕРЖДЕНО** их назначение и семантика — не использовать.

> **Для n8n-ноды:** основной сценарий — `client_credentials` (серверная интеграция, полный доступ к администрированию,
> не зависит от пароля конкретного человека). `password` — запасной вариант, если администратор не хочет давать
> приложению server-wide права.

### 3.3. Эндпоинт получения токена

```http
POST /api/v4.1/oauth2/token
Content-Type: application/json
```

Тело — discriminated union по `grant_type` (`discriminator.propertyName = grant_type`).

**`client_credentials`** (обязательны `client_id`, `client_secret`):

```json
{
  "grant_type": "client_credentials",
  "client_id": "QuWJ9XWvT9otdy9RSAduGA",
  "client_secret": "…40+ символов…"
}
```

**`password`** (по схеме обязательны `username`, `password`; `client_id` обязателен из базовой схемы `TokenRequest`):

```json
{
  "grant_type": "password",
  "client_id": "QuWJ9XWvT9otdy9RSAduGA",
  "username": "bot",
  "password": "123tr"
}
```

**`authorization_code`** (обязательны `auth_code`, `client_id`, `client_secret`):

```json
{
  "grant_type": "authorization_code",
  "client_id": "QuWJ9XWvT9otdy9RSAduGA",
  "client_secret": "…",
  "auth_code": "AVGTD123VBVERTY234CVB"
}
```

**`refresh_token`** (обязателен `refresh_token`):

```json
{ "grant_type": "refresh_token", "refresh_token": "ZTBHYTKYODITNJC3YI01OTM3LTG3NJUTYZG1N2IYNDQ0MDC0" }
```

> ❗ **Расхождение в первоисточниках:** руководство утверждает, что при любом запросе токена нужно указывать
> Application ID **и Secret**, но схемы `oauth2.password` и `oauth2.refresh_token` **не содержат** `client_secret`
> в `required`. **НЕ ПОДТВЕРЖДЕНО**, отклоняет ли сервер `password`-grant без `client_secret`.
> Безопасная стратегия в ноде: **всегда отправлять `client_id` + `client_secret`**, если они заданы в credential.

### 3.4. Ответ с токеном

```json
{
  "access_token": "NTLIYTQWODUTNMFJMC0ZNTQ1LWFIZDCTN2UXZJIWZWIYNTY5",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "ZTBHYTKYODITNJC3YI01OTM3LTG3NJUTYZG1N2IYNDQ0MDC0",
  "scope": "version:read users:read",
  "user_id": "bot",
  "display_name": "Bot",
  "url": "video.example.net",
  "k": "…",
  "call_id": "…"
}
```

| Поле | Тип | Комментарий |
|---|---|---|
| `access_token` | string | сам токен |
| `token_type` | string | `bearer` (в примере Chatbot Connector — строчными) |
| `expires_in` | number | секунды; 3600 |
| `refresh_token` | string | есть не для всех grant types |
| `scope` | **string** | не массив! Права через пробел — **НЕ ПОДТВЕРЖДЕНО**, какой именно разделитель (в примере — пробел) |
| `user_id` | string | для `client_credentials` — **НЕ ПОДТВЕРЖДЕНО**, что возвращается |
| `display_name`, `url`, `k`, `call_id` | string | служебные, для REST-ноды не нужны |

### 3.5. Поток authorization_code (браузерный)

Руководство администратора описывает пять шагов:

1. Подготовить Redirect URI (например `https://example.com/oauth/callback`).
2. Создать OAuth-приложение, указав этот Redirect URI и права.
3. Отправить пользователя на:

   ```
   https://{host}/oauth2/authrize?client_id={client_id}
   ```

   > ⚠️ Именно так в документации: **`authrize`** (опечатка вместо `authorize`). Реальный рабочий путь
   > **НЕ ПОДТВЕРЖДЁН** — в OpenAPI-спеке такого эндпоинта нет вообще. Проверять на живом сервере.

4. Пользователь вводит логин/пароль, проходит MFA, подтверждает права. Сервер редиректит на Redirect URI
   с параметром `?code={authorization_code}`.
5. Обменять код: `POST /oauth2/token` с `grant_type=authorization_code`.

**Отдельно в спеке** есть эндпоинты `GET /oauth2/auth` и `POST /oauth2/auth`, которые принимают
`client_id`, `response_type=code`, `username`, `password` (+ `remember_me`) и отвечают `302` на redirect_uri.
Это «программный» вариант того же шага — пароль передаётся в запросе, а не в UI.

> Для n8n-ноды authorization_code **не нужен**: он требует интерактивного браузера и редиректа на внешний URL,
> а n8n-нода работает в фоне. Оставить `client_credentials` / `password`.

### 3.6. Обновление и отзыв токена

| Действие | Запрос |
|---|---|
| Обновить | `POST /oauth2/token` с `grant_type=refresh_token` |
| Завершить сессию | `POST /oauth2/logout` с `{"access_token": "…"}` → `204` |
| Список токенов | `GET /oauth/access-tokens` (право `admin`) — фильтры `filter_id` (по client_id), `page`, `page_size`, сортировка по `id`/`client_id`/`user_id`/`expired_at` |
| Удалить токен | `DELETE /oauth/access-tokens/{token_id}` → `204` |

Важно: `refresh_token` **не продлевается** — «A new access key is issued for 1 hour. It cannot be renewed using this
method». То есть по истечении 7 дней нужна повторная полноценная авторизация.

### 3.7. TTL — итог

| Параметр | Значение по умолчанию | Настраивается |
|---|---|---|
| access token | **3600 с** | `access_token_ttl` в приложении |
| refresh token | **604800 с (7 дней)** | `refresh_token_ttl` |
| authorization code | не указано | `auth_code_ttl` |

Значения подтверждены дважды: руководством администратора («1 hour» / «7 days») и примером ответа Chatbot Connector
(`"expires_in": 3600`). Дефолты полей `*_ttl` в OpenAPI **не заданы** — конкретные числа 3600/604800 в спеке
отсутствуют, они взяты из руководства.

**Практика для ноды:** кэшировать токен в памяти credential/ноды, обновлять за ~60 с до `expires_in`;
при `401` — инвалидировать кэш и повторить один раз.

### 3.8. Scopes (права)

**142 области прав.** Полный список — в `_src/scopes.txt` (извлечён из `info.description` спецификации) и в
панели управления при создании приложения.

Критично для реализации:

> **Write-право НЕ включает read-право.** Дословно: «Write permission does NOT automatically include read permission.
> Explicitly select the desired permission.» То есть для «прочитать и изменить пользователя» нужно **два** scope:
> `users:read` **и** `users:write`.

Ключевые группы (используются в ноде):

| Scope | Даёт доступ к |
|---|---|
| `admin` | административные запросы (управление OAuth-приложениями, токенами) |
| `users:read` / `users:write` | поиск/чтение и создание/изменение/удаление пользователей, unban, disconnect |
| `users.avatar:read` / `users.avatar:write` | аватары |
| `users.addressbook:read` / `users.addressbook:write` | адресные книги |
| `groups:read` / `groups:write` / `groups.users:write` | группы и их состав |
| `conferences:read` / `conferences:write` | конференции: чтение / создание-изменение-удаление-run-stop |
| `conferences.invitations:read` / `conferences.invitations:write` | список приглашённых (планируемые участники) |
| `conferences.participants:read` | активные участники конференции |
| `conferences.messages:read` | архив сообщений чата конференции |
| `conferences.records:read` / `conferences.records:write` | записи |
| `conferences.sessions:read` / `conferences.sessions:write` | сессии (идyщие конференции) |
| `conferences.sessions.participants:read` / `…:write` | участники активных сессий |
| `conferences.sessions.participants.roles:read` / `…:write` | роли участников |
| `conferences.sessions.participants.devices:read` / `…:write` | устройства участников |
| `conferences.sessions.podiums.participants:read` / `…:write` | трибуны |
| `conferences.sessions.videolayouts:read` / `…:write` | раскладки |
| `conferences.sessions.files:read` / `…:write` | файлы сессии |
| `server.license:read` | лицензия, регистрационные данные |
| `version:read` | версия продукта (нужен Chatbot Connector для OAuth-подключения) |
| `statistics:read`, `statistics.disks:read`, `statistics.services:read`, `statistics.storages:read` | статистика |
| `system.services:read` / `write`, `system.notifications:write` | системные службы, уведомления |
| `chats.config:read` / `chats.config:write` | настройки чатов (только конфиг!) |
| `aliases:read` / `aliases:write` | алиасы |
| `oauth.clients:read` / `write`, `oauth.access_token:read` / `write` | управление OAuth |
| `settings:write` | общие настройки сервера |

Минимальный набор для «админской» ноды (пользователи + конференции + участники + лицензия):

```
users:read users:write groups:read groups:write
conferences:read conferences:write
conferences.invitations:read conferences.invitations:write
conferences.participants:read
conferences.sessions:read conferences.sessions:write
conferences.sessions.participants:read
server.license:read version:read
```

---

## 4. Общие соглашения API

### 4.1. Пагинация

Единый **набор имён** параметров во всём API:

| Параметр | Тип | Смысл |
|---|---|---|
| `page` | integer | номер страницы (в общем компоненте `default: 1`) |
| `page_size` | integer | записей на страницу |
| `sort_field` | string | поле сортировки |
| `sort_order` | integer | `0` = ascending, `1` = descending |

> ⚠️ Значения по умолчанию `page=1` и `sort_order=1` объявлены **только в общих компонентах**
> (`components/parameters/logs.page`, `components/parameters/sort_order`), которые подключены к эндпоинтам
> логов. У `/users`, `/conferences` и большинства других эндпоинтов эти параметры описаны инлайн как
> `type: integer` **без default и без enum**. То есть семантика `sort_order` (`0`/`1`) подтверждена
> только для логов; для `/users` и `/conferences` **НЕ ПОДТВЕРЖДЕНО**, принимает ли сервер `0`/`1`
> или строки `asc`/`desc`, и какой порядок по умолчанию.

> ⚠️ **Границы `page_size` в API не унифицированы** — это подтверждённый факт, а не догадка:

| Где | default | min | max |
|---|---|---|---|
| `/logs/*`, `GET /users/{id}/addressbook` (общий компонент `page_size`) | **100** | 1 | **2000** |
| `GET /accounts`, `GET /aliases` | **20** | 1 | **1000** |
| `GET /users`, `GET /conferences`, `GET /conferences/{id}/participants`, `GET /sessions`, `GET /groups` и большинство остальных | **не задано** (просто `type: integer`) | — | — |

Итого: явные границы объявлены только для 11 эндпоинтов логов и для `/accounts`, `/aliases`. Для остальных
**НЕ ПОДТВЕРЖДЕНО**, есть ли серверный максимум и какой. Практика для ноды: использовать `page_size=100` как
безопасный дефолт и позволять переопределение.

**Формат ответа-списка тоже не унифицирован** — три разных конверта:

| Эндпоинт | Форма ответа |
|---|---|
| `GET /users` | `{"users": [...], "next_page_id": 0}` |
| `GET /conferences` | `{"conferences": [...], "results": 42}` |
| `GET /conferences/{id}/participants` | `{"list": [...], "cnt": 42}` |
| `GET /conferences/{id}/invitations` | `{"invitations": [...]}` |
| `GET /accounts` | (см. §6.1) |
| `GET /oauth/access-tokens` | `{"tokens": [...], "next_page_id": 0}` |

То есть **универсального «items» нет**: имя массива зависит от сущности, а total-count есть только у части
(`results`, `cnt`), у остальных — только `next_page_id`. Это надо учитывать в generic-реализации.

> Общее правило: `next_page_id` — «идентификатор следующей страницы», а не «номер страницы».
> В спеке тип `integer`, значение `0` в примерах. **НЕ ПОДТВЕРЖДЕНО**, как именно его передавать в следующем
> запросе: параметра `page_id` в `/users` нет, есть только `page`. Скорее всего `next_page_id` — это и есть
> следующее значение `page`; поведение нужно проверить на живом сервере.

### 4.2. Фильтры

Именование: `filter_*` для точного совпадения, `filter_*_contains` / `filter_search_prefix` для подстроки.
Массивы передаются с `[]` в имени и `style: form, explode: false` — то есть **через запятую**, а не повтором ключа:

```
GET /users?filter_ids[]=ivanov@video.example.com,petrov@video.example.com
GET /conferences?origin_client_id[]=AAA,BBB
```

Даты в логах — **UNIX timestamp в секундах** (`integer`, `format: int64`), например `1769893200`.
Даты в конференциях (`after`/`before`) — тоже `integer` timestamp.
Часовой пояс — IANA-строка (`Europe/London`) в параметре `timezone`.

**Регистрозависимость:** подстрочный поиск по `display_name` в логах **регистрозависимый** («the search is
case-sensitive»). Для остальных фильтров регистр **НЕ ПОДТВЕРЖДЁН**.

### 4.3. Ошибки

Единый формат тела ошибки (`response.errorResponse`):

```json
{
  "code": 400,
  "message": "Human readable message",
  "trace_id": "1f2e3d4c5b6a",
  "errors": [
    {
      "code": "incorrectFieldValue",
      "type": "validation",
      "message": "Field 'topic' is invalid",
      "location": "topic",
      "reason": "…",
      "debug_message": "…",
      "validation": {
        "min_length": 1,
        "max_length": 255,
        "regex": "…",
        "enums": ["…"],
        "min_value": 0,
        "max_value": 100
      }
    }
  ]
}
```

| Поле | Тип | Смысл |
|---|---|---|
| `code` | **integer** | HTTP-подобный код (400/403/404/500) |
| `message` | string | общее сообщение |
| `trace_id` | string | идентификатор для логов сервера — **просить у поддержки** |
| `errors[]` | array | детализация по полям |
| `errors[].code` | **string** | строковый машинный код, напр. `incorrectFieldValue` |
| `errors[].type` | string | тип ошибки |
| `errors[].location` | string | имя поля |
| `errors[].validation` | object | ограничения поля (`enums`, `min_length`, `max_length`, `regex`, `min_value`, `max_value`) |

Обратите внимание: `code` на верхнем уровне — **integer**, а внутри `errors[]` — **string**. Это разные вещи.

**HTTP-коды в API:**

| Код | Кол-во операций | Когда |
|---|---|---|
| `400` | 316 | невалидное тело/параметры, `incorrectFieldValue` |
| `401` | 35 | нет/протух токен |
| `403` | 173 | токен валиден, но нет scope |
| `404` | 196 | объект не найден |
| `409` | 8 | конфликт (например `PATCH /sessions/{id}`) |
| `500` | 390 | внутренняя ошибка сервера |

`403` — самый частый источник боли: он означает **нехватку scope**, а не «нет объекта». В ноде стоит различать
`403` (→ «добавьте право X в OAuth-приложение») и `404` (→ «объект не существует»).

**Строковые коды ошибок** (в `errors[].code`) в спеке явно упоминаются: `incorrectFieldValue` (например
`incorrectFieldValue schedule.days`), `ownerNotIn…` (владелец конференции отсутствует в `invitations[]`),
`invalidScope` (из документации Chatbot Connector — не хватает `version:read`).
Полного реестра строковых кодов в OpenAPI **нет** — **НЕ ПОДТВЕРЖДЕНО**, их исчерпывающий список.

### 4.4. Лимиты

| Что | Значение | Источник |
|---|---|---|
| `page_size` (логи) | 1…2000, default 100 | OpenAPI |
| `page_size` (`/accounts`, `/aliases`) | 1…1000, default 20 | OpenAPI |
| `name` OAuth-приложения | 8…128 символов | OpenAPI |
| `secret` OAuth-приложения | 40…255 символов | OpenAPI |
| `user.id` | 1…32 символа | OpenAPI |
| `user.display_name` | 1…64 | OpenAPI |
| `user.email` | 3…250 | OpenAPI |
| `user.password` | 1…255 | OpenAPI |
| `invitation.id` | 1…255 | OpenAPI |
| Rate limiting | **НЕ ПОДТВЕРЖДЕНО** — в документации не описан | — |
| Максимум одновременных WS для ботов | 128 (с 5.5.3) | Chatbot Connector docs |

---

## 5. Пользователи

Тег `Users` (26 операций) + `accounts` (2) + `Group` (19) + `Guest` (2) + `aliases` (6).

### 5.1. Объект пользователя (`user.OutputEntity`)

| Поле | Тип | Описание |
|---|---|---|
| `id` | string | короткий ID (логин), напр. `john_doe` |
| `uid` | string | полный TrueConf ID (`user@server`) |
| `login_name` | string | логин |
| `display_name` | string | отображаемое имя |
| `email` | string | e-mail |
| `first_name`, `middle_name`, `last_name` | string | ФИО |
| `is_active` | boolean | активен ли аккаунт |
| `is_operator` | boolean | оператор |
| `status` | integer | статус (числовой код; расшифровка **НЕ ПОДТВЕРЖДЕНА**) |
| `avatar` | string | аватар |
| `company`, `department`, `branch`, `job_title`, `manager` | string | организационные поля |
| `address`, `work_phone`, `home_phone`, `mobile_phone` | string | контакты |
| `sip_number` | string | SIP-номер |
| `groups` | array of `user.OutputGroup` | группы |

> 🐞 **Дефект документации:** в спеке у `branch` описание «Department», а у `department` — «Branch»
> (перепутаны). Семантику полей нужно проверять на живом сервере.

### 5.2. Создание пользователя

```http
POST /api/v4.1/users
Content-Type: application/json
Authorization: Bearer …

{
  "id": "ivanov",
  "display_name": "Иван Иванов",
  "email": "ivanov@example.com",
  "password": "S3cret!",
  "is_active": true,
  "first_name": "Иван",
  "last_name": "Иванов",
  "company": "ООО Ромашка",
  "department": "ИТ",
  "job_title": "Инженер",
  "groups": ["group-id-1"]
}
```

**Обязательные поля:** `id`, `display_name`, `email`, `password`, `is_active`.
Право: `users:write`. Ответ `200`: `{"user": {…user.OutputEntity…}}`.

### 5.3. Поиск и чтение

```http
GET /api/v4.1/users?filter_login_name=ivanov&page=1&page_size=100
GET /api/v4.1/users?filter_search_prefix=иван
GET /api/v4.1/users?filter_ids[]=ivanov@video.example.com,petrov@video.example.com
GET /api/v4.1/users?filter_group_id={group_id}
GET /api/v4.1/users?filter_email=ivanov@example.com
GET /api/v4.1/users/{user_id}
```

Фильтры `/users`: `filter_display_name`, `filter_email`, `filter_emails[]`, `filter_first_name`,
`filter_group_id`, `filter_ids[]`, `filter_last_name`, `filter_login_name`, `filter_search_prefix`.
Право: `users:read`. Ответ: `{"users": [...], "next_page_id": N}`.

`filter_search_prefix` — «наличие префикса в любом из фильтруемых полей, кроме `filter_group_id`».

> **Поиск по логину vs по ID:** `GET /users/{user_id}` принимает `user_id` — в примерах это
> `john_doe@video.example.com` (полный TrueConf ID). Короткий `id` тоже работает как идентификатор
> (**НЕ ПОДТВЕРЖДЕНО** для всех случаев — в примерах используется полный ID).
> Для перевода списка логинов в внутренние ID есть `POST /accounts/exchange` (см. §6.1).

### 5.4. Изменение

```http
PATCH /api/v4.1/users/{user_id}
```

Поля: те же, что при создании, **все опциональны** (частичное обновление), плюс `current_password`
(для смены собственного пароля). Право: `users:write`. Ответ `200` с обновлённым `user`.

### 5.5. Блокировка / разблокировка

**Отдельного `POST /users/{id}/ban` в API нет.** Есть только:

```http
POST /api/v4.1/users/{user_id}/unban    → 204    # «Unblock user account», право users:write
```

Отсюда следует, что **блокировка выполняется через** `PATCH /users/{user_id}` с `{"is_active": false}`
(поле `is_active` — «Indicates whether the user is active»), а разблокировка — либо тем же `PATCH`
с `true`, либо специализированным `unban`.

> ⚠️ **НЕ ПОДТВЕРЖДЕНО**, что `is_active: false` — это именно «бан» (а не «деактивация учётной записи»),
> и что `unban` снимает именно то состояние, которое ставит `is_active: false`. На живом сервере нужно
> проверить: (1) меняется ли `is_active` после `unban`, (2) блокируется ли вход при `is_active: false`.
> В ноде безопасно: «Block» = `PATCH {is_active:false}`, «Unban» = `POST /unban`.

Дополнительно сессии:

```http
GET  /api/v4.1/users/{user_id}/sessions                                  # список сессий
POST /api/v4.1/users/{user_id}/disconnect                     → 204     # завершить сессию в клиенте
POST /api/v4.1/users/{user_id}/sessions/{session_id}/complete → 204
POST /api/v4.1/users/{user_id}/sessions/{session_id}/disable-autologin → 204
```

### 5.6. Удаление

```http
DELETE /api/v4.1/users/{user_id}          → 204
DELETE /api/v4.1/users  { "ids": ["a","b"] }  → 204     # массовое
```

### 5.7. Прочее по пользователям

| Метод | Путь | Назначение | Право |
|---|---|---|---|
| `GET` | `/users-export` | экспорт в **CSV** (`text/csv`), параметр `group_id` | `users:read` |
| `GET` | `/users-statuses?ids[]=` | статусы пользователей: `{"users": {"id": 1}}` | `users:read` |
| `POST` | `/users/validate-password` | проверка пароля на соответствие политике, `{"password": "…"}` → `204` | — |
| `GET/PUT/DELETE` | `/users/{id}/avatar` | аватар (PUT: `{"image": "base64"}`) | `users.avatar:*` |
| `GET/POST/PATCH/DELETE` | `/users/{id}/contacts[/{cid}]` | адресная книга | — |
| `GET` | `/users/{id}/addressbook` | адресная книга с фильтрами (v4.1+) | — |

---

## 6. Аккаунты, группы, гости, алиасы

### 6.1. `GET /accounts` — поиск аккаунтов

```http
GET /api/v4.1/accounts?filter_ids[]=ivanov&page=1&page_size=20
```

Возвращает список аккаунтов **всех типов** (администраторы, серверные аккаунты, гости) с доступом к серверу.
Примечательно: «A token is required, but an OAuth application can be created **without permissions**» —
то есть можно не выдавать ни одного scope. Это удобный «health-check» токена.

`POST /accounts/exchange` с `{"logins": ["a","b"]}` — получить внутренние ID по логинам.

### 6.2. Группы

| Метод | Путь | Назначение | Право |
|---|---|---|---|
| `GET` | `/groups` | поиск (`filter_display_name`, `filter_search`, `participant_id`) | `groups:read` |
| `POST` | `/groups` | создать (`display_name` обяз., `call_id`, `rights`, `sai_rights`, `allowed_webtools`) | `groups:write` |
| `GET/PATCH/DELETE` | `/groups/{group_id}` | чтение/правка/удаление | `groups:read/write` |
| `POST` | `/groups/{group_id}/add_users` | `{"user_ids": [...]}` | `groups.users:write` |
| `POST` | `/groups/{group_id}/delete_users` | `{"user_ids": [...]}` | `groups.users:write` |
| `POST` | `/groups/clear` | `{"ids": [...]}` → `202` | `groups:write` |
| `GET` | `/groups/{group_id}/contacts` | контакты группы | `groups:read` |
| `POST` | `/groups/import-ldap`, `GET /groups/search-ldap` | LDAP | `groups:*` |

### 6.3. Гости и алиасы

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/guests/{guest_id}` | «Invite a guest» — получение/создание гостевой ссылки |
| `PATCH` | `/guests/{guest_id}` | правка гостя (`display_name`, `id`) |
| `GET/POST` | `/aliases` | поиск / создание алиаса (`{"alias": {...}}`) |
| `GET/PATCH/DELETE` | `/aliases/{alias_id}` | CRUD |
| `DELETE` | `/aliases?ids[]=` | массовое удаление |

---

## 7. Конференции

Тег `Conference` — **46 операций**, `Session` — **22**, `SessionLayout` — 12, `Video Layout` — 10.

### 7.1. Список конференций

```http
GET /api/v4.1/conferences
  ?state=running
  &mode=PxP
  &access=public
  &owner=ivanov@video.example.com
  &after=1769893200&before=1771448340
  &topic=Маркетинг
  &scheduleType[]=once,week
  &page=1&page_size=100&sort_field=…&sort_order=1
  &timezone=Europe/Moscow
```

Фильтры: `access`, `after`, `before`, `filter_origin_client_is_system`, `invitation`, `invitations_substring`,
`mode`, `origin_client_id[]`, `origin_type`, `owner`, `registration_enabled`, `scheduleType[]`, `state`,
`timezone`, `topic`, `topic_cid_contains`.

Право: `conferences:read`. Ответ: `{"conferences": [...], "results": N}`,
элемент — `conference.ShortConferenceOutput`:

| Поле | Описание |
|---|---|
| `id` | ID конференции |
| `topic` | название |
| `owner` | ID владельца |
| `access` | `private` / `public` |
| `mode` | режим |
| `state` | `running` / `stopped` |
| `schedule`, `schedule_type` | расписание и его тип |
| `session`, `session_id` | активная сессия |
| `created_at` | время создания |
| `recording_enabled` | идёт ли запись |
| `origin_client_id`, `origin_type` | откуда создана |
| `max_guests_limit_enabled` | ограничение гостей |
| `invitations` | приглашённые |

> Сортировка (`sort_field`) для `/conferences` — в спеке **без enum** (`type: string`), допустимые значения
> **НЕ ПОДТВЕРЖДЕНЫ**.

### 7.2. Создание конференции

```http
POST /api/v4.1/conferences
```

**Обязательные поля:** `access`, `mode`, `owner`, `topic`, `schedule`.
Ответ `200`: `{"conference": {…conference.ConferenceOutput…}}` (58 полей).

**Перечисления (важно — именно эти значения):**

| Поле | ENUM |
|---|---|
| `access` | `private` \| `public` |
| `mode` | `PxP` \| `video lecture` \| `M\|R` \| `S\|L Smart Meeting` |
| `auto_invite` | `0` \| `1` \| `2` |
| `background_mode`, `foreground_mode` | `local` \| `global` \| `none` |
| `waiting_room_scope` | `guests` \| `unplanned` \| `strangers` \| `all` |
| `state` (только чтение) | `running` \| `stopped` |

Расшифровка режимов (из `x-enumDescriptions`):

* `PxP` — все видят и слышат друг друга;
* `video lecture` — все видят и слышат только владельца, владелец — всех;
* `M|R` — все видят докладчиков, докладчики видят и слышат других докладчиков и слышат аудиторию;
* `S|L Smart Meeting` — все видят выступающих, выступающие видят и слышат других выступающих и слышат аудиторию.

> ⚠️ В спеке есть **устаревшая** внутренняя схема
> `standard_internal_manager_interfaces_web_echo_v4_api_conference.PatchRequest` с другим enum:
> `PxP | OxP | S|L | S|L Smart Meeting`. Это артефакт v4.0. Для v4.1 использовать enum выше
> (`video lecture`, `M|R`). **НЕ ПОДТВЕРЖДЕНО**, принимает ли сервер v4.1 старые значения `OxP`/`S|L`.

**Расписание (`schedule`) — discriminated union по `type`:**

| `type` | Обязательные поля |
|---|---|
| `once` | `start_time`, `time`, `special_time_offset`, `duration` |
| `week` | `days` (непустой массив), `start_time`, `time`, `special_time_offset`, `duration` |
| `none` | — (несрочная конференция, «виртуальная комната»): передать `null` или `{"type":"none"}` |

`days` — enum: `monday`…`sunday`. Пустой массив `[]` **отвергается** сервером (`incorrectFieldValue schedule.days`).

**Владелец:** `owner` «must be present in `invitations[].id`, otherwise the request is rejected» с ошибкой
вида `ownerNotIn…`. То есть владельца нужно **явно добавить в список приглашённых**.

**Пример (разовая конференция):**

```json
{
  "topic": "Планёрка",
  "access": "private",
  "mode": "PxP",
  "owner": "ivanov@video.example.com",
  "max_participants": 50,
  "schedule": {
    "type": "once",
    "start_time": 1771500000,
    "time": "10:00",
    "special_time_offset": 0,
    "duration": 3600
  },
  "invitations": [
    { "id": "ivanov@video.example.com", "is_moderator": true },
    { "id": "petrov@video.example.com" }
  ]
}
```

> Типы и форматы `start_time` (`integer`?) и `time` (строка `HH:MM`?) в примерах не зафиксированы однозначно —
> **НЕ ПОДТВЕРЖДЕНО**. Проверять на живом сервере; в ноде вынести в отдельные поля с валидацией.

**Прочие важные поля создания:**

| Поле | Тип | Смысл |
|---|---|---|
| `max_participants` | integer | максимум участников |
| `max_guests` + `max_guests_limit_enabled` | integer/null + boolean | лимит гостей |
| `allow_only_planned_participants` | boolean | только приглашённые |
| `pin` | string | PIN-код |
| `waiting_room_enabled`, `waiting_room_list`, `waiting_room_scope` | | зал ожидания |
| `recording_enabled` | boolean | запись |
| `broadcast_enabled`, `broadcast_id` | boolean, string | трансляция |
| `join_options`, `join_options_enabled` | array, boolean | способы подключения |
| `rights` | object | права ролей `guest` / `user` |
| `participant_restrictions` | object | ограничения (FPS, качество видео, …) |
| `transcoding` | object | транскодинг |
| `layout_config` | object | раскладка (`scan_time`, `scan_type` 0/1, `sequence_type` 0/1) |
| `reminders`, `reminders_enabled` | array, boolean | напоминания |
| `registration` | object | регистрация на вебинар |
| `sai` | object | транскрибация |
| `tags` | array of string | теги |
| `mcu_mode`, `multicast_enabled`, `multicast_address` | | MCU / multicast |
| `meeting_room` | string/null | переговорная |

### 7.3. Чтение / изменение / удаление

```http
GET    /api/v4.1/conferences/{conference_id}?timezone=Europe/Moscow
PATCH  /api/v4.1/conferences/{conference_id}
DELETE /api/v4.1/conferences/{conference_id}          → 204
DELETE /api/v4.1/conferences  { "ids": [...] }        → 204
```

`GET` возвращает `{"conference": {...}}`. `conference.ConferenceOutput` содержит 58 полей, в том числе
**готовые ссылки для подключения**: `url`, `web_client_url`, `connect_urls`.

`PATCH` требует `id` в теле (`"id": string!` — обязательное поле), остальные опциональны. Дополнительно
появляются `scan_type` и `sequence_type` (integer).

> ⚠️ **НЕ ПОДТВЕРЖДЕНО:** обязателен ли `id` в теле `PATCH` на практике, или сервер сверяет его с path-параметром
> и отвергает при расхождении.

### 7.4. Запуск и остановка

```http
POST /api/v4.1/conferences/{conference_id}/run     → 204    # право conferences:write
POST /api/v4.1/conferences/{conference_id}/stop    → 204
POST /api/v4.1/conferences/{conference_id}/join    → 204    # подключить «себя» (токен) к сессии
GET  /api/v4.1/conferences/{conference_id}/me               # роли вызывающего в конференции
```

### 7.5. Участники

Две разные сущности — **не путать**:

**(A) Приглашённые / планируемые участники** (`invitations`, право `conferences.invitations:*`):

```http
GET    /api/v4.1/conferences/{cid}/invitations
POST   /api/v4.1/conferences/{cid}/invitations          { "invitation": { "id": "…" } }
GET    /api/v4.1/conferences/{cid}/invitations/{iid}
PATCH  /api/v4.1/conferences/{cid}/invitations/{iid}    { "invitation": { … } }
DELETE /api/v4.1/conferences/{cid}/invitations/{iid}    → 204
```

`conference.InvitationAddEntity`: обязателен `id` (1…255), опционально `display_name` (0…255; для существующего
пользователя сервер подставит имя из реестра).
`conference.InvitationEntity` (ответ): `id`, `uid`, `display_name`, `avatar`, `is_owner`, `status`, `type`.

**(B) Активные участники идущей сессии** (`participants`, право `conferences.participants:read`):

```http
GET /api/v4.1/conferences/{cid}/participants
  ?call_id=…&display_name=…&is_in_conf=true&instance=…
  &date_from=…&date_to=…&app_id=…&page=1&page_size=50
  &timezone=Europe/Moscow
```

Ответ: `{"list": [...], "cnt": N}`, элемент `conference.ParticipantEntity`:
`id`, `display_name`, `app_id`, `instance`-related, `join_time`, `leave_time`, `duration`, `leave_reason` (int),
`flag` (роль: переводчик/слушатель/докладчик), `lang_in`, `lang_out`, `bitrate_in/out`, `avg_cpu_load`,
`avg_sent_fps`, `video_w/video_h`.

**Приглашение и уведомление:**

```http
POST /api/v4.1/conferences/{cid}/invite   { "participants": [...] }  → 204   # conferences:write
POST /api/v4.1/conferences/{cid}/notify   { "invitations": [...] }   → 202   # conferences:write
```

### 7.6. Приглашения-ссылки, календарь, прочее

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/conferences/{cid}/deeplinks?case=&user=` | deeplink-ссылки |
| `GET` | `/conferences/{cid}/shared` | embed-ссылки |
| `GET` | `/conferences/{cid}/ics` | ICS-файл для календаря |
| `GET` | `/conferences/{cid}/calendars` | ссылки на календари |
| `GET` | `/conferences/{cid}/owner` | владелец |
| `GET` | `/conferences/{cid}/translations` | языковые дорожки |
| `POST` | `/conferences/{cid}/registrations` | регистрация участника вебинара (`fields`, `send_email`) |
| `GET/POST/PATCH/DELETE` | `/conferences/{cid}/foregrounds/...` | водяные знаки |
| `GET/PUT/DELETE` | `/conferences/{cid}/background[/image]` | фон |

### 7.7. Сессии (идyщие конференции)

Сессия — это «экземпляр» конференции. Управление живой конференцией идёт через `/sessions`.

| Метод | Путь | Назначение | Право |
|---|---|---|---|
| `GET` | `/sessions` | поиск (`conference_id`, `class`, `owner`, `after`, `before`) | `conferences.sessions:read` |
| `GET` | `/sessions/{sid}` | чтение | `conferences.sessions:read` |
| `PATCH` | `/sessions/{sid}` | правка на лету: `topic`, `pin`, `prolong_duration`, `participants_lock_enabled`, `waiting_room`, `layout_config` → `204` (возможен `409`) | `conferences.sessions:write` |
| `POST` | `/sessions/{sid}/stop` | остановить → `202` | `conferences.sessions:write` |
| `GET` | `/sessions/{sid}/participants` | участники сессии | `….participants:read` |
| `POST` | `/sessions/{sid}/participants-invite` | пригласить → `202` | `….participants:write` |
| `DELETE` | `/sessions/{sid}/participants/{pid}/instances/{inst}?reason=` | удалить участника | `….participants:write` |
| `PATCH` | `/sessions/{sid}/participants/{pid}/instances/{inst}` | `{"lang_in": "…"}` → `202` | `….participants:write` |
| `GET/PATCH` | `…/instances/{inst}/role` | роль участника (`{"role": int}`) | `….roles:*` |
| `POST/DELETE` | `…/instances/{inst}/podium` | трибуна (`{"force": bool}`) | `….podiums.participants:write` |
| `GET/PATCH` | `…/instances/{inst}/devices/{type}[/{id}]` | устройства (`{"is_muted": bool, "volume": int}`) | `….devices:*` |
| `GET` | `/sessions/{sid}/files` | файлы сессии | `….files:read` |
| `POST` | `/sessions/{sid}/transcribing-mode` | `{"mode": "none"\|"audio"}` | `conferences.sessions:write` |

> **Ключевая архитектурная деталь для ноды:** «participant» в живой сессии адресуется триадой
> `participant_id` + `instance` (+ `session_id`). Один пользователь может быть в конференции с нескольких
> устройств — `instance` их различает. Плоский «user_id» здесь не работает.

### 7.8. Записи

| Метод | Путь | Право |
|---|---|---|
| `GET` | `/conferences/{cid}/recordings` (фильтры `name`, `owner`, `topic`, `date_from`, `date_to`, `show_deleted`, `size`) | `conferences.records:read` |
| `GET` | `/conferences/{cid}/recordings/{rid}` | `conferences.records:read` |
| `GET` | `…/recordings/{rid}/download`, `…/stream` | `conferences.records:read` |
| `POST` | `…/recordings/start`, `pause`, `stop` | `conferences.records:write` |

---

## 8. Сервер, лицензия, статус

| Метод | Путь | Назначение | Право |
|---|---|---|---|
| `GET` | `/server?lang=` | информация о сервере: `config`, `contacts`, `integrations`, `links`, `product`, `web_config` | — (токен) |
| `GET` | `/product/version` | `{"version": {...}}` — версия приложения | `version:read` |
| `GET` | `/product/current-stats` | `{"stats": {...}}` — текущее использование лицензии | `statistics:read` |
| `GET` | `/product/stats?mode=&time_interval=&interval_step=&timezone=&before=&after=` | средняя статистика использования | `statistics:read` |
| `GET` | `/license/server-info` | `{"server_info": {...}}` — регистрационные метаданные | `server.license:read` |
| `GET` | `/license/extensions-links` | расширения | `server.license:read` |
| `POST` | `/license/activate-online` | онлайн-регистрация → `204` | `admin` |
| `POST` | `/license/activate-offline` | офлайн-регистрация → `204` | `admin` |
| `POST` | `/license/generate-request-file` | `{"registration_key", "server_name"}` | — |
| `POST` | `/license/upload-activation-file` | загрузить файл активации → `204` | `admin` |
| `GET` | `/info/disks` | диски (`fractional_length`, `measuring_unit`) | `statistics.disks:read` |
| `GET` | `/info/services` | системные службы | `statistics.services:read` |
| `GET` | `/server/storages` | хранилища | `statistics.storages:read` |
| `GET` | `/server/documentation?language=` | ссылки на документацию | — |
| `GET` | `/me` | кто вызывает: `admin` / `user` / `guest` / `oauth2_client` / `roaming_user` | — (токен) |
| `GET` | `/me/token` | информация о текущем токене | — (токен) |

> 💡 **`GET /me` — идеальный «тест соединения»** для n8n-ноды: он явно различает `oauth2_client`
> (значит токен получен через `client_credentials`) и `user`, а также показывает `admin`.
> ⚠️ Важная особенность: у `GET /me` и `GET /me/token` в спеке объявлены ответы только
> `200`, `400`, `404`, `500` — **`401` не объявлен** (при том, что у 35 других операций он есть).
> То есть реакция `/me` на невалидный токен документацией не определена — **НЕ ПОДТВЕРЖДЕНО**,
> вернёт ли он `400` или `401`. В ноде обрабатывать и `400`, и `401` как «токен не принят».

> 💡 `GET /product/version` — то, чем можно **автоопределить** версию API: если `/api/v4.1/product/version`
> отвечает `404`, пробовать `/api/v4`.

---

## 9. Чаты и сообщения — чего в Server API v4 НЕТ

Это важнейший вывод для проекта, чтобы не дублировать функциональность.

**В Server API v4 отсутствуют эндпоинты отправки сообщений в личные/групповые чаты.** Есть только:

| Метод | Путь | Что это |
|---|---|---|
| `GET` | `/conferences/{cid}/messages` | **архив** сообщений чата конференции (read-only). Фильтры: `session_id`, `date_from`, `date_to`, `from_call_id`, `to_call_id`, `message`, `timezone` |
| `GET` | `/conferences/{cid}/messages-export` | экспорт архива |
| `POST` | `/chats/get-config` | настройки чатов |
| `POST` | `/chats/patch-config` | `{"message_edit_timeout": int}` — только таймаут редактирования |
| `GET` | `/sessions/{sid}/files` | файлы, переданные в сессии |

То есть «чат» в Server API — это **чтение архива конференции и глобальные настройки**, но не мессенджер.

**Отправка сообщений от бота — только через Chatbot Connector** (см. §11).

---

## 10. Чем v4.1 отличается от v4.0

Сравнение выполнено программно по обоим YAML. Различий мало:

| | v4.0 | v4.1 |
|---|---|---|
| `servers[0].url` | `api/v4` | `api/v4.1` |
| `info.title` | TrueConf Server API v4 | TrueConf Server API v4.1 |
| Кол-во путей | 273 | 273 |
| Кол-во операций | **390** | **393** |
| Минимальная версия сервера | 5.5.3 | **5.5.6** |

**Удалённых операций нет.** Добавлены три:

```
+ GET   /users/{user_id}/addressbook          # адресная книга пользователя с фильтрами/пагинацией
+ GET   /users/{user_id}/addressbook/groups   # фильтры групп адресной книги
+ PATCH /configurations/transcriptions        # настройки транскрибации
```

**Практический вывод:** для ноды разница минимальна. Можно целиться в `v4` (доступен с 5.5.3, шире покрытие
серверов) и не терять почти ничего; `v4.1` нужен только для адресных книг и правки транскрибации.
Рекомендуется параметр версии в credential с дефолтом `v4.1` и фолбэком на `v4` при `404`.

---

## 11. Чем API v4 отличается от v3 и от Chatbot Connector

### 11.1. v4 vs v3 (кратко)

| Аспект | v3.x | v4.x |
|---|---|---|
| Префикс пути | `/api/v3`, `/api/v3.1` … `/api/v3.11` | `/api/v4`, `/api/v4.1` |
| Минимальная версия сервера | 4.3.9 (v3) | **5.5.3** |
| OAuth 2.0 | да (тот же `oauth2/token`) | да |
| `token_type` | `Bearer` | `bearer` |
| TTL access / refresh | 3600 / 604800 (подтверждено на docs v3) | 3600 / 604800 |
| Передача токена | `access_token` (query), Bearer | **Bearer — основной**, query — только legacy |
| Документация | внешний сайт `developers.trueconf.com/api/server/` | **встроенная в сервер**: `https://{host}/api/v4/docs/` (с 5.5.3), + OpenAPI 3.1 |
| Состав | базовые сущности (users, conferences, logs…) | + `/sessions/**` (живые сессии, устройства, роли, трибуны, раскладки), surveys, transcription, AI server, calendar connector |

Подтверждено: v3-документация описывает тот же OAuth2-поток и те же TTL («The lifetime of the access token is
1 hour. The refresh token lifetime is 1 week»), а также содержит `token_type: "Bearer"`.

**НЕ ПОДТВЕРЖДЕНО (детально):** точный перечень различий в схемах тел запросов между v3 и v4 — v3-документация
опубликована только как JS-приложение на внешнем домене, машиночитаемой спецификации v3 найти не удалось
(`swagger.json`, `openapi.json`, `dist/v3_*.yaml` → 404). Для миграции v3→v4 полагаться на таблицу
совместимости и проверку на живом сервере.

> Замечание: v3 поддерживает ветки до `v3.11`, и на серверах 5.5.6 одновременно живут v3.8…v3.11, v4 и v4.1.
> Старые интеграции не ломаются — это позволяет ноде не спешить с миграцией.

### 11.2. Server API v4 vs Chatbot Connector

Это **два разных продукта с разными протоколами**. Их нельзя смешивать в одной ноде.

| | **Server API v4** (этот документ) | **Chatbot Connector** |
|---|---|---|
| Назначение | администрирование сервера | чат-боты: сообщения, чаты, файлы |
| Протокол | REST/HTTP, request-response | **WebSocket** + HTTP для токена и загрузки файлов |
| База HTTP | `https://{host}/api/v4.1/` | `https://{host}/bridge/api/` (или `http://localhost:4309/bridge/api/`) |
| WebSocket | нет | `wss://{host}/websocket/chat_bot/` (или `ws://localhost:4309/websocket/chat_bot/`) |
| Служба | TrueConf Server (web) | **TrueConf Bridge**, TCP **4309**, проксируется через TrueConf Web Manager |
| Авторизация | OAuth 2.0, `Bearer` | JWT-токен + команда `auth` по WS |
| Токен | `POST /api/v4.1/oauth2/token` | `POST /bridge/api/client/v1/oauth/token` |
| Мин. версия | 5.5.3 (v4), 5.5.6 (v4.1) | **5.5.0** |
| Лимит соединений | — | **128** одновременных WS (с 5.5.3) |
| TTL токена | 1 час | **1 месяц** (`expires_at`) |
| Сообщения | ❌ нет | ✅ `sendMessage`, файлы, геолокация, контакты, опросы, кнопки |
| Пользователи/конференции | ✅ да | ❌ нет (только участники чата) |

**Точка стыка двух API** (единственное место, где они пересекаются — важно не перепутать):

Chatbot Connector умеет авторизоваться **двумя** способами. Первый — собственный парольный
(`POST /bridge/api/client/v1/oauth/token`, `client_id` — константа `"chat_bot"`, `grant_type` — константа
`"password"`, ответ `201` + JWT на 1 месяц). Второй, добавленный в **5.5.3**, — как раз **через Server API v4**:

1. `POST /api/v4/oauth2/token` с `grant_type=password` — токен Server API (право **`version:read`**
   обязательно, иначе `invalidScope`);
2. `POST /bridge/api/client/v1/auth/web_rest_api_token` (`{"client_id": "<логин бота>", "token": "<access_token>"}`)
   → `authorization_code`;
3. `POST /bridge/api/client/v1/auth/token` (`grant_type=authorization_code`) → JWT на 1 месяц.

> ⚠️ Обратите внимание: в официальном примере Chatbot Connector используется путь **`/api/v4/oauth2/token`**
> (не `v4.1`), и `grant_type=password` **без `client_secret`** — это фактическое подтверждение того, что
> `password`-grant работает без секрета (см. открытый вопрос №1 в §13).

Детальное описание протокола (WebSocket `wss://{host}/websocket/chat_bot/`, подпротокол `json.v1`, команда
`auth`, конверт сообщений, все методы, коды ошибок) — в отдельном документе
[`chatbot-connector.md`](./chatbot-connector.md). Здесь не дублируем.

**Вывод для проекта:** нужны **две ноды** (или один node с двумя credential-типами и разными операциями):
* `TrueConf Server` — REST v4.1, OAuth2 `client_credentials`, администрирование;
* `TrueConf Bot` — WS Chatbot Connector, JWT, сообщения/чаты.

Попытка сделать сообщения через Server API v4 невозможна технически.

---

## 12. Рекомендации по реализации n8n-ноды

### 12.1. Credential

```
Поля:
  serverUrl     — https://video.example.com   (без /api/...)
  apiVersion    — v4.1 | v4                   (default v4.1)
  authMethod    — clientCredentials | password
  clientId      — OAuth application ID
  clientSecret  — OAuth application Secret    (password: type password)
  username      — только для password grant
  password      — только для password grant
  scopes        — необязательно, для диагностики
```

Тест: `GET /me` → проверить, что вернулся `oauth2_client` (для `client_credentials`) или `user`.

### 12.2. Токен-менеджмент

* Кэш токена в памяти процесса ноды (не в credential — секреты n8n read-only).
* Ключ кэша: `serverUrl + apiVersion + clientId + grantType + username`.
* Обновление за 60 с до `expires_in`; при `401` — сброс кэша и **один** повтор запроса.
* `refresh_token` использовать, если он есть; для `client_credentials` его обычно нет — просто новый запрос.

### 12.3. Обработка ответов

* Разворачивать конверт: `users` / `conferences` / `list` / `invitations` / `tokens` / `client` / `conference` /
  `user` — **имя ключа своё у каждой сущности**. Универсального `items` нет.
* Для «Return All» — цикл по `page` до пустого ответа или до `page_size`-кратного уменьшения;
  `next_page_id` использовать осторожно (см. §4.1).
* `204` → возвращать `{ success: true }`, а не пустой массив.
* `403` → понятная ошибка «не хватает права X, добавьте его в OAuth-приложение (API → OAuth2)».
  Полезно маппить `errors[].code == "invalidScope"` в отдельное сообщение.
* `400` → показывать `errors[].message` + `location`, это точная причина.

### 12.4. Приоритет операций для MVP

1. **Users**: Create, Get, Search (list), Update, Block (`PATCH is_active:false`), Unban, Delete.
2. **Conferences**: Create, Get, Update, Delete, Run, Stop, List.
3. **Participants**: Invitations (add/list/remove), Active participants (list), Invite, Notify.
4. **Server**: `GET /me`, `GET /product/version`, `GET /license/server-info`, `GET /server`.

Этого достаточно, чтобы покрыть заявленные сценарии «пользователи, конференции, участники».

---

## 13. Что осталось НЕ ПОДТВЕРЖДЁННЫМ (сводка)

| # | Вопрос | Почему не подтверждено | Как проверить |
|---|---|---|---|
| 1 | Нужен ли `client_secret` для grant `password` и `refresh_token` | Руководство говорит «обязательно указывать ID и Secret», но схемы `oauth2.password` / `oauth2.refresh_token` **не содержат** `client_secret` в `required`. **Частично снят:** официальный пример Chatbot Connector (§11.2) вызывает `/api/v4/oauth2/token` с `grant_type=password` **без** `client_secret` — значит для `password` он не обязателен. Для `refresh_token` остаётся неясным | запрос `refresh_token` без `client_secret` на живом сервере |
| 2 | Точный путь браузерного входа `oauth2/authrize` (опечатка?) | в доке `authrize`, в OpenAPI такого пути нет | открыть в браузере на тестовом сервере |
| 3 | Как передавать `next_page_id` в следующем запросе | в `/users` нет параметра `page_id`, только `page` | итерация по страницам на реальных данных |
| 4 | Максимальный `page_size` для `/users`, `/conferences` и др. | в спеке просто `type: integer`, без `maximum` | бинарный поиск большого `page_size` |
| 5 | Что именно делает `POST /users/{id}/unban` и эквивалентно ли `is_active:false` бану | нет прямого `ban`-эндпоинта, семантика не описана | сравнить `GET /users/{id}` до/после обеих операций |
| 6 | Допустимые значения `sort_field` для `/users`, `/conferences`, `/participants` | в спеке `type: string` без `enum` | перебор или ответ `400` с `validation.enums` |
| 7 | Полный реестр строковых кодов в `errors[].code` | в OpenAPI нет enum, только примеры | собрать логи ошибок на тестах |
| 8 | Тип и формат `schedule.start_time` / `schedule.time` | примеров с реальными значениями нет | создать конференцию, посмотреть ответ |
| 9 | Разделитель в `scope` ответа токена (пробел?) | тип `string`, в примере пробел | посмотреть ответ на живом сервере |
| 10 | Зависимость доступных эндпоинтов от редакции (Free/PRO) | не описано в спеке | вызвать `recordings`, `sai` на Free |
| 11 | Обязателен ли `id` в теле `PATCH /conferences/{id}` и сверяется ли он с path | схема помечает `id` обязательным, логика не описана | запрос без `id` / с несовпадающим |
| 12 | Есть ли rate limiting | не упомянут в документации | нагрузочный тест |
| 13 | `client_secretkey` и `trusted_password` — что это | присутствуют в enum, нигде не описаны | вопрос в поддержку TrueConf |
| 14 | Семантика полей `branch` vs `department` | в спеке описания перепутаны | создать пользователя с разными значениями |
| 15 | Точные различия схем v3 → v4 | машиночитаемой спеки v3 не существует в открытом доступе | сравнение на живом сервере 5.5.6 (там есть и v3.11, и v4) |
| 16 | `status` (integer) пользователя — расшифровка кодов | в спеке только «User status» | `GET /users-statuses` на разных состояниях |
| 17 | `sort_order`: `0`/`1` или `asc`/`desc`, и порядок по умолчанию для `/users`/`/conferences` | enum и default объявлены только в общих компонентах для логов | запрос с `sort_order=0` и `=1`, сравнить порядок |
| 18 | Код ответа `GET /me` на невалидный токен (`400` или `401`) | `401` не объявлен в ответах `/me` | запрос с заведомо битым токеном |

---

## 14. Приложение: карта эндпоинтов по тегам

393 операции распределены по 45 тегам. Полный машиночитаемый список — `_src/inventory.tsv`.

| Тег | Операций | О чём |
|---|---|---|
| `Survey` | 52 | опросы |
| `Conference` | 46 | конференции |
| `Configuration` | 31 | настройки сервера |
| `Users` | 26 | пользователи |
| `Session` | 22 | живые сессии |
| `Group` | 19 | группы |
| `auth-providers` | 12 | провайдеры авторизации |
| `SessionLayout` | 12 | раскладки в сессии |
| `Video Layout` | 10 | общие раскладки |
| `logs-calls` | 10 | история звонков |
| `Gateway`, `OAuth` | 9 + 9 | шлюзы, OAuth-приложения |
| `License` | 8 | лицензия |
| `auth-zones` | 8 | зоны авторизации |
| `aliases`, `Configs`, `Info`, `logs-recordings`, `TrueConf Calendar Connector` | по 6 | |
| `OAuth2`, `broadcast-preset`, `document`, `Plugin Kerberos`, `TrueConf AI Server`, `SysService` | по 5 | |
| `logs-conferences`, `Mail plugins` | по 4 | |
| `LDAP`, `logs-connections`, `logs-events`, `logs-settings`, `OAuth2 V2` | по 3 | |
| `accounts`, `chat`, `Endpoints`, `TrueConf Enterprise`, `Guest`, `ICE` | по 2 | |
| `auth-manifest`, `Layout`, `Video layout`, `Software Clients` | по 1 | |

**Важно:** `Survey` — самый большой тег (52 операции), но для заявленной задачи (администрирование сервера:
пользователи, конференции, участники) он не нужен. `Configuration` (31) — тонкая настройка сервера, тоже
за пределами MVP.

---

## 15. Источники

| Что | URL |
|---|---|
| API v4.1 (Scalar UI, ru) | https://trueconf.ru/docs/server-api/ru.html |
| OpenAPI v4.1 (ru/en) | https://trueconf.ru/docs/server-api/dist/v41_ru.yaml · `v41_en.yaml` |
| OpenAPI v4.0 (ru/en) | https://trueconf.ru/docs/server-api/dist/v4_ru.yaml · `v4_en.yaml` |
| Руководство администратора: работа с API | https://trueconf.ru/docs/server/ru/admin/api/ |
| Руководство администратора (en) | https://trueconf.com/docs/server/en/admin/api/ |
| Chatbot Connector — общее описание | https://trueconf.ru/docs/chatbot-connector/ru/overview/ |
| Chatbot Connector — введение (auth, WS) | https://trueconf.ru/docs/chatbot-connector/ru/connect-and-auth/ |
| Chatbot Connector — коды ошибок | https://trueconf.ru/docs/chatbot-connector/ru/errors/ |
| python-trueconf-bot | https://github.com/trueconf/python-trueconf-bot |
| Встроенная документация на сервере | `https://{host}/api/v4/docs/` (с 5.5.3) |

### Сохранённые артефакты (`docs/research/_src/`)

| Файл | Что |
|---|---|
| `v41_ru.yaml`, `v41_en.yaml`, `v4_ru.yaml`, `v4_en.yaml` | первоисточники OpenAPI |
| `intro_v41.md` | вводная часть спеки: scopes + таблица версий |
| `scopes.txt` | 142 scope |
| `inventory.tsv` | все 393 операции: метод, путь, тег, summary |
| `oauth.dump.txt`, `oauth2.schemas.txt` | OAuth-эндпоинты и схемы grant types |
| `users.dump.txt`, `users.compact.txt` | пользователи/группы/алиасы |
| `conf.dump.txt`, `conf.compact.txt`, `conf_schema.txt` | конференции |
| `misc.dump.txt`, `misc.compact.txt`, `fields.txt` | сервер/лицензия/сессии, схемы полей |
| `error.schemas.txt`, `page.schemas.txt` | ошибки и пагинация |
| `diff.txt` | сравнение v4.0 ↔ v4.1 |
| `guide_en.txt`, `guide_ru.txt` | текст руководства администратора |
