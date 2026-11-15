# Тестирование

Два уровня проверок, оба не требуют установленного TrueConf Server:

1. **Unit-тесты протокола** — `npm test`, поднимают mock Bridge внутри процесса.
2. **E2E через реальный n8n** — `python deploy/e2e.py suite`, mock Bridge работает отдельной
   службой на хосте n8n, workflow создаются и запускаются через REST API n8n.

Живой TrueConf Server нужен только для финальной приёмки (см. «Проверка на реальном сервере»).

## Unit-тесты

```bash
npm test
```

`npm test` собирает проект и запускает `tests/client.test.mjs` (node:test). Mock-сервер
`tests/mock-bridge.mjs` реализует `/oauth/token`, `/files` и WebSocket-протокол со строгими
правилами: `id` должен расти, каждое событие должно быть подтверждено.

Что проверяется (14 проверок):

| Группа | Проверки |
|---|---|
| `parseServerUrl` | схема по умолчанию, отбрасывание пути, `ws/wss`, ошибки на пустом и не-HTTP URL |
| Авторизация | обмен логина/пароля на JWT, кеширование токена, понятная ошибка при неверном пароле |
| BridgeClient | auth по WebSocket, монотонный `id`, ack событий, маппинг `errorCode`, автопереподключение, singleton на бота |
| Файлы | `uploadFile` + multipart (проверяются заголовок `Upload-Task-Id`, имя файла, MIME, байты), сборка multipart с `preview` |

## E2E через n8n

Стенд:

```
n8n (n8n.example.com:5678)  ──ws/http──►  mock TrueConf Bridge (systemd unit tc-e2e)
      ▲                                       127.0.0.1:4309 (bridge) / 4310 (control)
      │ REST API (cookie-сессия владельца)
deploy/e2e.py  ──SSH──►  хост n8n
```

```bash
python deploy/e2e.py start   # загрузить mock на хост, поднять unit tc-e2e
python deploy/e2e.py setup   # создать credential "TrueConf E2E mock" и первый workflow
python deploy/e2e.py suite   # 13 проверок
python deploy/e2e.py state   # что mock получил от n8n (методы, файлы, соединения)
python deploy/e2e.py stop
```

Скрипт `scripts/e2e/n8n-suite.mjs` (выполняется на хосте n8n) для каждого сценария создаёт workflow
через `POST /rest/workflows`, запускает его через `POST /rest/workflows/:id/run`
(`triggerToStartFrom`), ждёт завершения и разбирает вывод ноды из execution data.

Проверки suite:

| Сценарий | Что подтверждается |
|---|---|
| sendMessage | workflow успешен; mock получил `sendMessage`; в выводе ноды есть `messageId` |
| getChats | нода возвращает два чата из mock-а (по item на чат) |
| sendFile | HTTP Request скачал файл → нода вызвала `uploadFile`, отправила multipart (файл дошёл) и `sendFile` |
| trigger | workflow активирован (`activeVersionId`), бот подключился вторым WS-соединением, push события породил execution, в его выводе есть `text` события; деактивация работает |
| credential | `POST /rest/credentials/test` → `Connection successful!` (проверяет и нормализацию URL) |

Текущий результат: **13/13 PASS**. Лог прогона сохраняется в выводе команды `suite`.

### Особенности n8n 2.47, учтённые в стенде

* `POST /rest/workflows/:id/activate` требует `versionId` (версия создаётся при создании workflow).
* `GET /rest/executions/:id?includeData=true` отдаёт `data` **строкой** в «flattened» формате:
  массив, где элемент 0 — корень, а строки `"5"` — ссылки на другие элементы. Suite разворачивает
  это в дерево (`unflattenExecutionData`).
* Ручной запуск: `POST /rest/workflows/:id/run` с `{triggerToStartFrom:{name}}`.
* Встроенный CLI `n8n execute` на этом стенде не подходит: он поднимает task broker и конфликтует
  с работающей службой (порт 5679).

## Проверка на реальном сервере

Живой стенд: **TrueConf Server 5.5.8** (`trueconf.example.com`, домен `example.trueconf.name`), бот
`bot@example.trueconf.name`, цель — личный чат с `eladm@example.trueconf.name`.

```bash
# .env: TRUECONF_PATH / TRUECONF_BOT_USER / TRUECONF_BOT_PASS / TRUECONF_TARGET_USER
python deploy/live.py
python deploy/live.py --target eladm@example.trueconf.name --text "проверка"
```

`deploy/live.py` собирает конфиг и запускает `scripts/live/n8n-live.mjs` **на хосте n8n**, чтобы
n8n обращался к TrueConf из своей сетевой позиции. Сценарии:

| Проверка | Что подтверждается |
|---|---|
| bot token endpoint | `POST /bridge/api/client/v1/oauth/token` → `201` + JWT |
| n8n credential test | кнопка Test в n8n → `Connection successful!` |
| sendMessage | workflow успешен, вернулись `chatId` и `messageId` |
| getHistory | отправленный текст реально лежит в истории чата |
| sendFile | файл (Code-нода создаёт бинарные данные) загружен и отправлен, вернулся `fileId` |
| trigger (activate) | workflow с TrueConf Trigger активируется, бот подключается по WS |
| trigger (event) | реальное сообщение запускает execution, payload события доходит до workflow |
| trigger (deactivate) | деактивация закрывает соединение |

Текущий результат: **10/10 PASS**.

Что осталось за пределами автоматизации: визуальная проверка в клиенте TrueConf (сообщение и файл
видны в чате), поведение при рестарте `trueconf-bridge` и при истечении JWT (месяц).

### Подготовка стенда, который использовался

1. TrueConf Server 5.5.8 установлен на ALT Linux 11.1 (пакет `trueconf-server-5.5.8.10030-altp11`),
   лицензия Free уже зарегистрирована.
2. Бот `bot@example.trueconf.name` создан в панели (`/admin/` → Пользователи), тип «Пользователь».
3. Для Server API v4 (не нужен самой ноде, но нужен для администрирования) включён HTTPS
   скриптом `scripts/setup/enable-trueconf-tls.sh`: добавляет `Listen 443`, самоподписанный
   сертификат и SSL-настройки в `conf.d/10-tls.ssl`, не трогая HTTP на 80.
   Откат: тот же скрипт с `--rollback`.

## Диагностические скрипты

| Скрипт | Назначение |
|---|---|
| `deploy/tc_host.py` | выполнение команд/скриптов на хосте TrueConf (`--sudo`, `--file`) |
| `scripts/setup/enable-trueconf-tls.sh` | включение HTTPS на TrueConf (с `--rollback`) |
| `scripts/recon/01-server-info.sh` | версии n8n/n8n-workflow, каталоги, порты, env |
| `scripts/recon/02-after-install.sh` | состояние службы и логи после установки пакета |
| `scripts/recon/03-verify-node-types.sh` | список зарегистрированных типов нод через REST |
| `scripts/recon/10…27-*.sh` | исследование хоста TrueConf (службы, БД, OAuth-клиенты, веб-конфиг) |
| `scripts/e2e/n8n-probe*.mjs` | разбор форматов REST-ответов n8n 2.47 (execution data, activate) |
| `scripts/e2e/n8n-verify.mjs` | тест credential и деактивация оставшихся probe-workflow |
| `scripts/e2e/n8n-cleanup.mjs` | удаление тестовых workflow и mock-credential |

Запуск скриптов на хосте n8n: `cd ../n8n_deploy && uv run python tools/rssh.py --file <путь>`
(с `--sudo` для чтения `/var/lib/n8n` и `/etc/n8n`).
