# Установка и обновление

## Что именно ставится

Пакет `n8n-nodes-trueconf` — обычный npm-пакет community-нод. n8n 2.x ищет пакеты на диске при
старте (не в базе данных), поэтому установка = распаковать пакет в каталог пользователя n8n и
перезапустить службу. Публикация в npm не нужна.

Пакет не требует `npm install` на сервере: единственная runtime-зависимость (`ws`, WebSocket-клиент)
включена в tarball через `bundleDependencies`.

## Требования

| Компонент | Требование |
|---|---|
| n8n | 2.x (проверено на 2.47.7, `n8nNodesApiVersion: 1`) |
| Node.js | >= 24 (требование самого n8n 2.x) |
| TrueConf Server | 5.5.0+ с запущенным TrueConf Bridge (`trueconf-bridge`) |
| Права | root на хосте n8n (раскладка файлов и перезапуск службы) |

Пути ниже — для нативной установки n8n из репозитория `n8n_deploy`
(`N8N_USER_FOLDER=/var/lib/n8n`, служба `n8n.service`, пользователь `n8n`).
Для другой установки замените `/var/lib/n8n` на свой `N8N_USER_FOLDER`.

## Ручная установка

```bash
# на машине разработчика
npm install
npm run build
npm pack                                  # n8n-nodes-trueconf-0.1.0.tgz

# скопировать tarball на сервер
scp n8n-nodes-trueconf-0.1.0.tgz eladm@192.168.0.11:/tmp/

# на сервере (root)
TARGET=/var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf
rm -rf "$TARGET"
install -d -o n8n -g n8n -m 0750 "$TARGET"
tar -xzf /tmp/n8n-nodes-trueconf-0.1.0.tgz -C "$TARGET" --strip-components=1
chown -R n8n:n8n "$TARGET"
find "$TARGET" -type d -exec chmod 0750 {} +
find "$TARGET" -type f -exec chmod 0640 {} +

systemctl restart n8n
```

Важно: служба n8n работает с `UMask=0027`, `ProtectSystem=strict` и `ProtectHome=true`.
Она **не увидит** пакет, положенный в `/tmp` или `/home`, и не прочитает файлы, доступные только
root. Поэтому — только `/var/lib/n8n`, владелец `n8n`, права `0750/0640`.

## Автоматическая установка

```bash
cp deploy/.env.example deploy/.env
# SSH_HOST / SSH_PORT / SSH_USER / SSH_PASSWORD

python deploy/deploy.py            # build + pack + upload + install + restart + health-check
python deploy/deploy.py --no-build # переиспользовать уже собранный dist
```

Скрипт использует `paramiko` (есть в `.venv` проекта `n8n_deploy`) и `deploy/install-node.sh`.

## Проверка, что ноды загрузились

1. В логах службы (при старте) ошибок про пакет быть не должно:

   ```bash
   journalctl -u n8n --since '-5 min' -o cat | grep -iE 'trueconf|community|packages'
   ```

2. Через API n8n (cookie-авторизация владельца):

   ```bash
   curl -s -c /tmp/c -X POST http://127.0.0.1:5678/rest/login \
        -H 'content-type: application/json' \
        -d '{"emailOrLdapLoginId":"admin@example.com","password":"..."}' >/dev/null
   curl -s -b /tmp/c http://127.0.0.1:5678/rest/node-types \
     | grep -o 'n8n-nodes-trueconf\.[a-zA-Z]*' | sort -u
   ```

   Ожидаемо: `n8n-nodes-trueconf.trueConf`, `n8n-nodes-trueconf.trueConfTool`
   (авто-вариант для AI-агентов), `n8n-nodes-trueconf.trueConfTrigger`.

3. Готовый скрипт-проверка: `scripts/recon/03-verify-node-types.sh`
   (запускается через `rssh.py --file`, пароль владельца — в переменной `N8N_PASS`).

## Обновление

Повторите установку с новым tarball: старый каталог удаляется, новый распаковывается, служба
перезапускается. Credentials и workflow в базе n8n не затрагиваются, id типов нод не меняются.

```bash
python deploy/deploy.py
```

## Удаление

```bash
rm -rf /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf
systemctl restart n8n
```

Workflow, где использовались ноды TrueConf, после удаления покажут «Unrecognized node type» —
это ожидаемо.

## Диагностика типичных проблем

| Симптом | Причина и решение |
|---|---|
| Нод нет в панели | Пакет лежит не в `$N8N_USER_FOLDER/.n8n/nodes/node_modules/` или не перезапущена служба |
| `Skipping package ... supports up to 1.0` | В `package.json` указан `n8nNodesApiVersion: 2`; должен быть `1` |
| `UnrecognizedNodeTypeError` | Класс в файле `X.node.js` назван не `X` (имя класса должно совпадать с именем файла до первой точки) |
| `Cannot find module 'ws'` | В tarball не попала bundled-зависимость (соберите через `npm pack`, не копируйте `dist/` руками) |
| `EACCES` при установке из UI | npm-кеш недоступен пользователю n8n (`/var/cache/npm`); ручная установка из tarball этого не требует |
| Ошибка TLS при проверке credential | Включите **Ignore SSL Issues** для самоподписанного сертификата TrueConf |
