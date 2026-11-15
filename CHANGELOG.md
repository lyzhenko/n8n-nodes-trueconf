# Changelog

Все заметные изменения проекта. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версии — [SemVer](https://semver.org/lang/ru/).

## [0.1.0] — 2026-11-15

Первая рабочая версия: интеграция с TrueConf через Chatbot Connector.

### Добавлено

* Credential **TrueConf API**: адрес сервера (нормализация схемы и порта), TrueConf ID и пароль бота,
  опция игнорирования ошибок TLS; кеширование JWT на месяц и проверка учётных данных кнопкой Test.
* Нода **TrueConf** (action):
  * Message: Send Message, Send File, Edit Message, Delete Message, Forward Message, Get Message,
    Get Chat History;
  * Chat: Get Many, Get, Create Personal Chat, Create Group Chat, Create Channel, Get Participants;
  * Bot: Get Bot Info.
* Нода **TrueConf Trigger**: приём событий по WebSocket с авто-подтверждением, переподключением
  с экспоненциальным backoff, фильтрами по событиям и chat ID, опцией игнорирования собственных
  сообщений и доставкой сообщений, накопленных пока workflow был выключен.
* Отправка файлов: `uploadFile` → multipart `POST /files` → `sendFile`, с подписью и режимом разметки.
* Разрешение адресата: chat id или TrueConf ID пользователя (автоматическое создание личного чата).
* Unit-тесты протокола против mock TrueConf Bridge (14 проверок).
* E2E-стенд `deploy/e2e.py` + `scripts/e2e/n8n-suite.mjs`: 13 проверок через реальный n8n
  (sendMessage, getChats, sendFile, trigger, credential test).
* Живые интеграционные тесты `deploy/live.py` + `scripts/live/n8n-live.mjs` против настоящего
  TrueConf Server 5.5.8: 10/10 проверок (авторизация бота, credential Test, отправка сообщения и
  файла, история чата, активация trigger-ноды и запуск workflow по реальному сообщению).
* `scripts/setup/enable-trueconf-tls.sh` — включение HTTPS на TrueConf (нужно для Server API v4,
  у которого OAuth2 не работает по HTTP), с откатом.
* Скрипты установки пакета на хост n8n (`deploy/deploy.py`, `deploy/install-node.sh`).
* Документация: установка, архитектура, тестирование, подготовка TrueConf Server; исследования
  Chatbot Connector, Server API v4 и механики community-нод n8n 2.47.
