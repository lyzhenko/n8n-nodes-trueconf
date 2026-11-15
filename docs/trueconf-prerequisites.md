# Подготовка TrueConf Server и бота

Всё, что нужно сделать на стороне TrueConf до подключения ноды. Источники: официальная
документация TrueConf (ссылки в конце) и [research/trueconf-server-install.md](research/trueconf-server-install.md).

## 1. Версия и редакция

* Нужен **TrueConf Server 5.5.0+** — Chatbot Connector (API чат-ботов) входит в поставку с этой версии.
* **TrueConf Server Free подходит**: боты — обычные учётные записи, отдельной лицензии на них нет,
  Chatbot Connector не урезан. Ограничения Free: 1000 онлайн-пользователей, 10 PRO, 1 гость, 1 SIP/H.323.
* Лицензия Free бессрочная, но **продлевается раз в год** и требует постоянного исходящего TCP **4310**
  к `reg.trueconf.com` (без связи сервер отключается через 12 часов; офлайн-регистрации во Free нет).
* Ключ приходит на **корпоративную** почту после заполнения формы на
  <https://trueconf.ru/downloads/trueconf-server/> (бесплатные ключи на личные email-домены могут отклонить).

## 2. Установка сервера

Официально поддерживаются: Windows Server 2012–2025 / Windows 10-11 Pro, Debian 11–13, CentOS Stream 9,
Astra Linux SE 1.7/1.8, **Альт Сервер 10/11**, РЕД ОС 7.3/8. Также есть официальный Docker-образ.

| Вариант | Когда удобен |
|---|---|
| `.rpm` / `.deb` с сайта | обычный сервер из списка поддержки |
| Репозиторий `mirror.trueconf.ru` | нужны автообновления (`altlinux/p11`, `debian/bookworm` и т.д.) |
| `docker run trueconf/trueconf-server` | быстрый тестовый стенд; образ официальный |

Порты:

| Порт | Назначение |
|---|---|
| 80 | веб-панель (и редирект на HTTPS) |
| 443 | HTTPS / WSS (Web Manager — проксирует Bridge) |
| 4307 | передача файлов и медиа |
| **4309** | **TrueConf Bridge** (HTTP API и WebSocket чат-ботов), слушает локально |
| 4310 (исходящий) | контроль лицензии Free |

Для n8n достаточно доступа к `4309` (если n8n на том же хосте — `127.0.0.1:4309`) или к `443`
(если через Web Manager, схема `https://`).

## 3. Учётная запись бота

1. Панель управления → **Пользователи и группы** → создать пользователя, например `bot@video.example.com`.
2. Задать **пароль** (вход по паролю должен быть разрешён на сервере; при NTLM/Kerberos/MFA
   останется только OAuth-способ, который нода пока не поддерживает).
3. Бот должен быть **пользователем этого сервера** (Registry или LDAP). Гостевые учётки и
   пользователи других серверов (федерация) не подходят.
4. Специального флага «бот» в TrueConf нет — достаточно обычного пользователя.
5. Права: писать в личный чат можно без специальных прав; для отправки в **канал** или групповой
   чат бот должен быть участником с ролью, у которой есть право писать (`owner`, `admin`,
   `conf_owner`, `conf_moderator`, `writer`; роль `user` в канале писать не может).

## 4. Проверка, что Bridge отвечает

С хоста n8n (подставьте свои логин/пароль бота):

```bash
curl -sk -X POST http://127.0.0.1:4309/bridge/api/client/v1/oauth/token \
  -H 'content-type: application/json' \
  -d '{"client_id":"chat_bot","grant_type":"password","username":"bot@video.example.com","password":"secret"}'
```

Ожидаемый ответ — `201 Created` и JSON:

```json
{"access_token":"eyJhbGciOiJSU0EtT0FFUCIsImVuYyI6IkEyNTZHQ00ifQ","token_type":"JWT","expires_at":1761121632}
```

Ошибки:

| Ответ | Значение |
|---|---|
| `400 invalid_grant` | неверный логин или пароль |
| `403 auth_method_disabled` | на сервере отключён вход по паролю — нужен OAuth-способ |
| соединение отклонено | Bridge не запущен или порт 4309 недоступен (проверьте `systemctl status trueconf-bridge`) |

## 5. Сертификат и адрес

* TrueConf по умолчанию использует самоподписанный сертификат. В credential включите
  **Ignore SSL Issues** либо укажите адрес локального Bridge (`http://127.0.0.1:4309`), где TLS нет вовсе.
* Если n8n и TrueConf на разных хостах, доступ через Web Manager: `https://trueconf.example.com`
  (порт 443). Пути `/bridge/api/...` и `/websocket/chat_bot/` проксируются автоматически.
* Внутри Docker-контейнера с n8n `127.0.0.1` — это сам контейнер; используйте адрес сервера TrueConf.

## 6. Ограничения протокола, о которых стоит помнить

* Одно WebSocket-соединение = одна сессия бота; сервер держит до **128** соединений (с 5.5.3).
* События нужно подтверждать в течение **300 секунд**, иначе соединение закрывается.
* JWT живёт **месяц**; уже открытое соединение продолжает работать после истечения токена до разрыва.
* Лимит текста сообщения — 4096 символов (по документации клиентской библиотеки; сервером отдельно
  не подтверждено).
* Лимиты файлов задаёт администратор: `maxSize` и список расширений можно узнать методом
  `getFileUploadLimits` (в ноде не выведено, доступно через `raw`-вызовы).

## Ссылки

* [TrueConf Chatbot Connector — обзор](https://trueconf.ru/docs/chatbot-connector/ru/overview/)
* [Подключение и авторизация](https://trueconf.ru/docs/chatbot-connector/ru/connect-and-auth/)
* [Работа с сообщениями](https://trueconf.ru/docs/chatbot-connector/ru/messages/)
* [TrueConf Server — руководство администратора](https://trueconf.ru/docs/server/ru/admin/introduction/)
* [Загрузка TrueConf Server](https://trueconf.ru/downloads/trueconf-server/)
* [Docker-образ](https://hub.docker.com/r/trueconf/trueconf-server)
