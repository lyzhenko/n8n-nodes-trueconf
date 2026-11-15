# Community-node пакет для n8n 2.x: разработка, сборка, установка

Исследование выполнено на реальном сервере **n8n-server.example.com** (n8n.example.com, ALT Linux 11.1,
нативная установка, systemd-юнит `n8n.service`, юзер `n8n`).

Факты окружения (замерено, а не по памяти):

| Что | Значение | Откуда |
|---|---|---|
| n8n | **2.47.7** | `/opt/n8n/bin/n8n --version`, `.../n8n/package.json` |
| node / npm | **v26.13.1 / 11.20.0** | `node -v`, `npm --version` |
| `engines` самого n8n | `{"node": ">=24.0.0"}` | `/opt/n8n/lib/node_modules/n8n/package.json` |
| `n8n-workflow` (зависимость n8n) | **2.47.2** | `/opt/n8n/lib/node_modules/n8n/node_modules/n8n-workflow` |
| `n8n-core` | 2.47.4 | там же |
| `N8N_USER_FOLDER` | `/var/lib/n8n` → данные в `/var/lib/n8n/.n8n` | `/etc/n8n/n8n.env` |
| БД | PostgreSQL 17 (не sqlite) | `DB_TYPE=postgresdb` |
| `N8N_RUNNERS_MODE` | **не задан** → дефолт `internal` | `@n8n/config` `TaskRunnersConfig.mode = 'internal'` |
| `N8N_UNVERIFIED_PACKAGES_ENABLED` | `true` (непроверенные пакеты разрешены) | `n8n.env` |
| `N8N_CUSTOM_EXTENSIONS` | не задан | `n8n.env` |
| Установленные community-nodes | **нет** (`/var/lib/n8n/.n8n/nodes/node_modules` отсутствует, `installed_packages` = 0 строк) | `ls`, `psql` |

---

## 1. Структура пакета community-node

### 1.1. Раскладка репозитория

```
n8n-nodes-trueconf/
├── nodes/Trueconf/Trueconf.node.ts          # исходники (TS)
├── nodes/Trueconf/Trueconf.node.json        # codex (категории/документация)
├── credentials/TrueconfApi.credentials.ts
├── dist/                                    # результат build → публикуется
│   ├── nodes/Trueconf/Trueconf.node.js
│   ├── credentials/TrueconfApi.credentials.js
│   ├── nodes/Trueconf/trueconf.svg          # иконки копируются как есть
│   └── (опционально) known/nodes.json, known/credentials.json,
│                     types/nodes.json, types/credentials.json
├── package.json
├── tsconfig.json
└── eslint.config.mjs
```

`dist/` — единственное, что попадает в npm-пакет (`"files": ["dist"]`) и единственное, что читает n8n:
TypeScript в рантайме не грузится **никогда**.

### 1.2. `package.json` — что реально обязательно

Загружаются только два места: `n8n.nodes` / `n8n.credentials` (см. `PackageDirectoryLoader.loadAll`) и
(если есть) `dist/known|types/*.json` (`LazyPackageDirectoryLoader.loadAll`). Остальное — метаданные для npm/UI.

```json
{
  "name": "n8n-nodes-trueconf",
  "version": "0.1.0",
  "description": "TrueConf nodes for n8n",
  "keywords": ["n8n-community-node-package"],
  "license": "MIT",
  "author": { "name": "...", "email": "..." },
  "repository": { "type": "git", "url": "https://..." },
  "files": ["dist"],
  "scripts": {
    "build": "n8n-node build",
    "dev": "n8n-node dev",
    "lint": "n8n-node lint",
    "lint:fix": "n8n-node lint --fix",
    "release": "n8n-node release"
  },
  "n8n": {
    "n8nNodesApiVersion": 1,
    "nodes": ["dist/nodes/Trueconf/Trueconf.node.js"],
    "credentials": ["dist/credentials/TrueconfApi.credentials.js"]
  },
  "peerDependencies": { "n8n-workflow": "*" },
  "devDependencies": {
    "@n8n/node-cli": "*",
    "eslint": "9.x",
    "prettier": "3.x",
    "typescript": "5.x"
  }
}
```

Требования по полям (что проверяет платформа, а что — линтер):

| Поле | Обязательно | Кто проверяет | Комментарий |
|---|---|---|---|
| `name` начинается с `n8n-nodes-` (или `@scope/n8n-nodes-`) | да | `CommunityPackagesService.parseNpmPackageName` (для установки через UI/CLI), glob-скан `n8n-nodes-*` для ФС | Иначе пакет не попадёт в скан каталога. Зарезервированные имена (`n8n-nodes-base` и т.п.) запрещены |
| `n8n.n8nNodesApiVersion` | да (иначе считается legacy level 1) | `checkNodesApiVersion` | В 2.47.7 максимум **1.0**; допускается число или строка `"<major>[.<minor>]"` |
| `n8n.nodes` | да | `PackageDirectoryLoader` | массив относительных путей к **.js** (`dist/...`); пустой массив = пакет «без нод» |
| `n8n.credentials` | если есть креды | там же | массив путей к `*.credentials.js` |
| `files: ["dist"]` | настоятельно | npm | без этого в тарбол попадёт `src/`, `.env` и мусор |
| `main` | **нет** | — | ни `PackageDirectoryLoader`, ни lazy-загрузчик `main` не читают. В официальном шаблоне `n8n-nodes-starter` поля `main` нет |
| `engines.node` | опционально | npm/информативно | n8n 2.47.7 сам требует node >= 24 |
| `peerDependencies.n8n-workflow` | да, по конвенции | npm (peer resolution) | n8n **не сверяет** версию; при рантайме `n8n-workflow` резолвится в версию из `/opt/n8n` (см. §4.9) |
| `n8n.strict` | нет | `@n8n/node-cli` / cloud-verification | рантайм-загрузчик его не читает |

### 1.3. `tsconfig.json` (минимально достаточный)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "declaration": false,
    "sourceMap": false,
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "useUnknownInCatchVariables": false
  },
  "include": ["nodes/**/*.ts", "credentials/**/*.ts"]
}
```

`n8n-node build` использует свою сборку (tsc/bundler + копирование ассетов) и при необходимости генерирует
`dist/known/*.json` и `dist/types/*.json` — каталоги дескрипторов для «ленивой» загрузки.
Если этих файлов нет (как у большинства пакетов, собранных `tsc`+`gulp`), n8n просто делает `require()`
каждого файла из `n8n.nodes` — это видно в логе: `"Can't enable lazy-loading"` (debug) → 
`Loaded all credentials and nodes from <pkg>`.

### 1.4. Официальный тулинг 2025-2026: `@n8n/node-cli`

Замерено в registry.npmjs.org (13.11.2026): `latest/stable = 0.56.4`, `rc = 1.2.1`, `beta = 0.57.3`
(пакет публикуется с 2025-08-21). `bin: {"n8n-node": "bin/n8n-node.mjs"}`, `peerDependencies: {"eslint": ">= 9"}`.
В зависимостях CLI уже сидят линтеры: `eslint-plugin-n8n-nodes-base ^2.0.0`, `@n8n/eslint-plugin-community-nodes 0.39.0`,
`@n8n/ai-node-sdk 0.37.4`, `typescript-eslint`, `eslint-plugin-import-x`.

Установка/создание проекта:

```bash
npm create @n8n/node@latest n8n-nodes-trueconf -- --template programmatic/example
# либо
npm i -D @n8n/node-cli          # в существующем проекте
```

Команды `n8n-node` (актуальный официальный набор):

| Команда | Назначение |
|---|---|
| `n8n-node new [name]` | скаффолд проекта; `--template declarative/custom \| declarative/github-issues \| programmatic/example`, `--skip-install`, `--force` |
| `n8n-node build` | компиляция TS + копирование ассетов + бандлинг → готовый `dist/` |
| `n8n-node dev` | поднимает n8n и линкует ноду в `<user-folder>/.n8n/custom`, пересборка на изменения; флаги `--external-n8n`, `--custom-user-folder <path>` (по умолчанию `~/.n8n-node-cli`). С n8n 3.x по умолчанию поднимает контейнер → нужен Docker/Podman или `--external-n8n` |
| `n8n-node lint` / `lint --fix` | ESLint по правилам verified-community-nodes |
| `n8n-node release` | build + lint + changelog + git tag + GitHub release + `npm publish` (через release-it) |
| `n8n-node cloud-support enable\|disable` | strict-режим ESLint для допуска в n8n Cloud |

Требования к ESLint: **ESLint 9+** (flat config, `eslint.config.mjs`), плагин
`eslint-plugin-n8n-nodes-base` версии **^2.0.0** (конфиг `plugin:n8n-nodes-base/community` в старых проектах,
сейчас — `@n8n/eslint-plugin-community-nodes`, правило `n8n-object-validation` проверяет как раз
`n8n.n8nNodesApiVersion`/`n8n.nodes`/`n8n.credentials` и требует префикс `dist/`).

TL;DR по тулингу: **node-cli нужен для разработки/сборки, но НЕ нужен на сервере для установки** —
серверу достаточно готового `dist/` + `package.json` (+ прод-зависимости, если они есть).

---

## 2. Как установить локальный (не из npm) пакет на этот сервер

### 2.1. Как n8n 2.x находит community-пакеты (по исходникам, не по памяти)

Ключевые места (`/opt/n8n/lib/node_modules/n8n/dist/`):

1. `modules/community-packages/community-packages.module.js` → `nodeLoaders()`:
   ```js
   const dir = path.join(Container.get(InstanceSettings).nodesDownloadDir, 'node_modules');
   return await scanDirectoryForPackages(dir, { excludeNodes, includeNodes });
   ```
2. `n8n-core/dist/nodes-loader/scan-directory-for-packages.js` — glob-скан каталога:
   ```js
   fastGlob('n8n-nodes-*',              { cwd: nodeModulesDir, onlyDirectories: true, deep: 1 })
   fastGlob('@*/n8n-nodes-*',           { cwd: nodeModulesDir, onlyDirectories: true, deep: 2 })
   ```
   для каждого каталога → `new LazyPackageDirectoryLoader(...)` + `checkNodesApiVersion(loader.packageJson)`;
   несовместимый пакет пропускается с warning:
   `Skipping package "<name>": it requires node API version X, but this n8n version supports up to 1.0.`
3. `n8n-core/dist/instance-settings/instance-settings.js`:
   ```js
   this.customExtensionDir = path.join(this.n8nFolder, 'custom');   // <N8N_USER_FOLDER>/.n8n/custom
   this.nodesDownloadDir   = path.join(this.n8nFolder, 'nodes');    // <N8N_USER_FOLDER>/.n8n/nodes
   ```
4. `dist/load-nodes-and-credentials.js`:
   * `loadNodesFromCustomDirectories()` грузит `customExtensionDir` **и** все каталоги из
     `N8N_CUSTOM_EXTENSIONS` (env `CUSTOM_EXTENSION_ENV`, разделитель — **`;`**) через `CustomDirectoryLoader`
     (имя пакета `CUSTOM`, отдельный `package.json` не нужен);
   * `loadPackage(name)` грузит `nodesDownloadDir/node_modules/<name>` через `PackageDirectoryLoader`.

**Вывод, подтверждённый экспериментом:** список пакетов берётся **с файловой системы при старте**,
а не из БД. Таблица `installed_packages` — это ledger для UI (список «Community nodes», кнопки
update/uninstall, `N8N_REINSTALL_MISSING_PACKAGES`). Пакет, лежащий в `nodes/node_modules`, но отсутствующий
в БД, **загрузится и будет работать**, однако в Settings → Community nodes его не будет видно.

### 2.2. Рецепт A (основной): положить пакет как «community package»

Целевые пути на этом сервере:

```
/var/lib/n8n/.n8n/nodes/package.json                    # ledger: {"name":"installed-nodes","dependencies":{...}}
/var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf/  # сам пакет (распакованный)
    package.json
    dist/...
    node_modules/                                        # только runtime-зависимости, если есть
```

Пошагово (от root через `--sudo`, потому что `/var/lib/n8n` — `drwxr-x--- n8n:n8n`):

```bash
# 1. собрать пакет на dev-машине
npm ci && npm run build && npm pack          # → n8n-nodes-trueconf-0.1.0.tgz
# 2. скопировать тарбол на сервер (например, в /root или /var/tmp — НЕ в /tmp, см. §2.4)
scp n8n-nodes-trueconf-0.1.0.tgz root@n8n.example.com:/var/lib/n8n/.n8n/
# 3. распаковать в node_modules (ровно как это делает сам n8n: tar --strip-components=1)
install -d -o n8n -g n8n -m 0750 /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf
tar -xzf /var/lib/n8n/.n8n/nodes/n8n-nodes-trueconf-0.1.0.tgz \
    -C /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf --strip-components=1
# 4. если у пакета есть runtime-зависимости — поставить их ТАК ЖЕ, как это делает n8n
cd /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf
sudo -u n8n HOME=/var/lib/n8n npm install \
    --omit=dev --omit=peer --audit=false --fund=false --bin-links=false \
    --install-strategy=shallow --ignore-scripts=true --package-lock=false \
    --cache /var/lib/n8n/.npm
# 5. владелец/права: всё должно принадлежать n8n:n8n
chown -R n8n:n8n /var/lib/n8n/.n8n/nodes
find /var/lib/n8n/.n8n/nodes -type d -exec chmod 0750 {} +   # UMask юнита = 0027
find /var/lib/n8n/.n8n/nodes -type f -exec chmod 0640 {} +
# 6. прописать пакет в ledger (чтобы он появился в UI; на загрузку не влияет)
python3 - <<'PY'
import json,io
p='/var/lib/n8n/.n8n/nodes/package.json'
d=json.load(open(p)); d.setdefault('dependencies',{})['n8n-nodes-trueconf']='0.1.0'
json.dump(d,open(p,'w'),indent=2)
PY
# 7. рестарт — обязателен (см. §2.3)
systemctl restart n8n
# 8. убрать тарбол
rm -f /var/lib/n8n/.n8n/n8n-nodes-trueconf-0.1.0.tgz
```

Проверка:

```bash
# a) в логе (N8N_LOG_LEVEL=info уже стоит) после старта:
journalctl -u n8n --since "-3 min" | grep -iE "n8n-nodes-trueconf|Skipping package"
# b) быстрым и надёжным способом — прямым прогоном ноды:
N8N_LOG_LEVEL=debug /opt/n8n/bin/n8n execute --id <workflowId> --rawOutput | head -40
#    (в debug-логе будет "Loaded all credentials and nodes from n8n-nodes-trueconf {nodes: 1}")
# c) REST: GET /rest/community-packages (cookie админа) — покажет пакет только если он есть в БД
# d) UI: node panel по displayName; Settings → Community nodes — только для пакетов из ledger
```

### 2.3. Нужен ли рестарт

Да, для нового каталога в `nodes/node_modules` — рестарт обязателен: загрузчики строятся один раз в
`LoadNodesAndCredentials.init()` при старте процесса.

Hot reload существует, но включается только явно: `dist/server.js`
`if (process.env.N8N_DEV_RELOAD === 'true') { void loadNodesAndCredentials.setupHotReload(); }`
(+ монтируется `dev.controller` → `POST /rest/dev/reload`). На проде `N8N_DEV_RELOAD` не задан →
правка файлов на диске ничего не перезагружает.

### 2.4. Подводные камни этого сервера (все проверены)

1. **`PrivateTmp=true` в юните.** У сервиса свой `/tmp` (и `/var/tmp`). Пакет, положенный вами в `/tmp/...`,
   сервис **не увидит**. Не стейджить в `/tmp`. `ProtectHome=true` — `/home`, `/root` для сервиса тоже недоступны.
2. **`ProtectSystem=strict` + `ReadWritePaths=/var/lib/n8n /var/log/n8n`.** Писать сервис может только в эти
   два каталога. Каталог расширений вне `/var/lib/n8n` (например `/opt/n8n-nodes/...` или `/srv/...`) будет
   **только для чтения** — для загрузки этого достаточно, но `n8n` не сможет там ничего создать/обновить.
3. **npm у пользователя `n8n` сейчас не работает.** Глобальный npm-cache = `/var/cache/npm`, владелец `root`,
   поэтому:
   ```
   $ sudo -u n8n npm view n8n-nodes-mcp version
   npm error code EACCES ... path /var/cache/npm/_cacache/tmp/...
   ```
   Тот же EACCES ловит и `eladm`. Следствие: **установка community-node из UI на этом сервере сейчас упадёт**
   (`downloadPackage` вызывает `npm pack`), а также упадёт любой ручной `npm install` от `n8n`/`eladm`.
   Лечение (одно из): `chown -R n8n:n8n /var/cache/npm` **или** добавить в `/etc/n8n/n8n.env`
   `NPM_CONFIG_CACHE=/var/lib/n8n/.npm` (и `install -d -o n8n -g n8n /var/lib/n8n/.npm`).
4. **`peerDependencies` и дубликат `n8n-workflow`.** Проверено: `npm install --omit=dev` с
   `"peerDependencies": {"n8n-workflow": "*"}` в npm 11 **скачивает `n8n-workflow` внутрь пакета**
   (93 пакета, 60 МБ в `node_modules`). После этого нода грузит свою копию `n8n-workflow`, и ломаются
   `instanceof`-проверки (`NodeApiError`, `NodeOperationError`), сравнения типов, `NodeConnectionTypes` —
   классические «невнятные» ошибки вида `Cannot find module 'bn.js'` / «is not a constructor» / ошибок
   сериализации. n8n сам этого избегает: после распаковки тарбола он **вырезает** `devDependencies`,
   `peerDependencies`, `optionalDependencies` из `package.json` и только потом делает `npm install`
   (`community-packages.service.js`, `downloadPackage`). Повторяйте это поведение: `--omit=peer`
   (или удалить `peerDependencies` перед установкой зависимостей).
5. **Права.** `/var/lib/n8n` = `drwxr-x--- n8n:n8n`, юнит с `UMask=0027`. Файлы, созданные root'ом
   с umask 022, читаются, но каталог `nodes/` должен оставаться записываемым для `n8n` (UI-установки,
   prune). Минимум: `chown -R n8n:n8n`, каталоги `0750`, файлы `0640`.
6. **Один и тот же пакет в двух местах.** `runDirectoryLoader` бросит
   `nodes package <name> is already loaded. Please delete this second copy at path <dir>` — не копируйте
   пакет одновременно в `nodes/node_modules` и в `custom`/`N8N_CUSTOM_EXTENSIONS`.
7. **Дубликат имени ноды.** Ключ типа = `<packageName>.<nodeName>`, например `n8n-nodes-trueconf.trueconf`.
   Для каталога `custom` префикс всегда `CUSTOM.` — типы называются `CUSTOM.trueconf`, и при переходе
   с `custom` на полноценный пакет **все существующие workflows придётся перепривязать** (тип ноды меняется).
8. **Прод-БД не должна знать о пакете, которого нет на диске.** Если запись в `installed_packages` есть,
   а файлов нет, n8n логирует `Not reinstalling package ...`/`n8n detected that some packages are missing`
   и (при `N8N_REINSTALL_MISSING_PACKAGES=true`) пытается переустановить с registry.

### 2.5. Рецепт B (для разработки): `N8N_CUSTOM_EXTENSIONS` / каталог `custom`

Проверено на этом же бинаре: каталог расширений грузится `CustomDirectoryLoader` и **не требует**
`package.json` у пакета — достаточно `*.node.js`/`*.credentials.js`; но и пакет с `package.json`
в `node_modules/` внутри каталога тоже подхватывается (glob `node_modules/*/package.json`,
`node_modules/@*/*/package.json`).

```bash
install -d -o n8n -g n8n -m 0750 /var/lib/n8n/.n8n/custom
ln -s /var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf \
      /var/lib/n8n/.n8n/custom/node_modules/n8n-nodes-trueconf   # или N8N_CUSTOM_EXTENSIONS=/path
systemctl restart n8n
```

Плюсы: не нужен ledger, удобно для итераций (`n8n-node dev` линкует именно в `<user-folder>/.n8n/custom`).
Минусы: типы нод получают префикс `CUSTOM.`; `codex.categories` принудительно дополняется `Custom Nodes`;
в UI такие ноды не считаются community-пакетом.

### 2.6. Что НЕ является способом установки локального пакета

* `POST /rest/community-packages` (`RestController('/community-packages')`, scopes
  `communityPackage:install|update|uninstall|list`) — только npm-registry: внутри `npm pack <name>@<version>`.
  Локальный tarball/path не принимается.
* `N8N_COMMUNITY_PACKAGES='[{"name":"n8n-nodes-x","version":"1.2.3"}]'` +
  `N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV=true` — декларативная установка **тоже только из registry**
  (сверяется с `installed_packages`, лишнее удаляется, ошибки логируются, но старт не падает).
* `n8n community-node --uninstall --package <name>` — CLI умеет только удалять (и чистить credentials).

---

## 3. Как n8n 2.x валидирует пакет при загрузке

| Проверка | Где | Поведение при несоответствии |
|---|---|---|
| `n8n.n8nNodesApiVersion` ≤ `N8N_NODES_API_VERSION` (= **1.0** в 2.47.7) | `n8n-workflow/dist/cjs/nodes-api-version.js` `checkNodesApiVersion` | на старте: `Skipping package "<pkg>": it requires node API version 2.0, but this n8n version supports up to 1.0. Upgrade n8n ...`; ноды не грузятся, при использовании — `UnrecognizedNodeTypeError: Unrecognized node type: <pkg>.<node>`. При установке через UI — `IncompatibleNodesApiVersionError` |
| `n8nNodesApiVersion` синтаксически неверный (например `"v1"`) | там же | `reason: 'malformed'` → пакет тоже пропускается («declares an invalid n8n node API version») |
| отсутствие `n8n` поля | `PackageDirectoryLoader.loadAll()` | пакет молча пропускается (`if (!n8n) return;`), нод 0 |
| наличие файлов из `n8n.nodes` | `loadNodeFromFile` → `loadClass` → `require` | исключение при загрузке, пакет не регистрируется |
| имя класса = имя файла до первой точки | `DirectoryLoader.loadClass`: `path.parse(sourcePath).name.split('.')[0]` | `UserError('Class could not be found. Please check if the class is named correctly.')` — т.е. `dist/nodes/Trueconf/Trueconf.node.js` обязан экспортировать класс `Trueconf` |
| `Node "<x>" has a builderHint on the "<operation/reource/mode>" discriminator` | `validate-node-description.js` | `UnexpectedError` — `builderHint` нельзя ставить на `operation`/`resource`/`mode` |
| путь иконки внутри каталога пакета | `getIconPath` (`isContainedWithin`) | `UnexpectedError: Icon path ... is not contained within the package directory` |
| `executeSingle` | `loadNodeFromFile` | `UserError('"executeSingle" has been removed ...')` |
| версия `n8n-workflow` | **не проверяется нигде** | при рантайме берётся из `/opt/n8n/.../n8n-workflow` (2.47.2); локальная копия в пакете вызовет расхождение типов |
| checksum | `npm-utils.verifyIntegrity` | только для «vetted» пакетов из каталога n8n, когда `N8N_UNVERIFIED_PACKAGES_ENABLED=false`. Сравнивается `dist.integrity` **из registry** с ожидаемым; локальную поставку не проверяет вообще. На этом сервере `unverifiedEnabled=true` → checksum не требуется |

Что ломается при несоответствии версии API нод: пакет не загружается целиком (все ноды пакета), workflow
с этими нодами падает на `Unrecognized node type`, а UI-установка/обновление возвращает
`IncompatibleNodesApiVersionError` с полями `requiredNodesApiVersion`/`supportedNodesApiVersion`.
Ошибка не «мягкая»: поймать её на уровне ноды нельзя.

---

## 4. Требования к нодам (n8n 2.x, `n8n-workflow` 2.47.2)

### 4.1. Версионирование

```ts
description: INodeTypeDescription = {
  ...
  version: [1],          // массив = несколько версий; currentVersion определяет nodeVersions
  defaultVersion: 1,     // какая версия выбирается в UI по умолчанию
};
```
* `version: number | number[]`; `defaultVersion?: number` (`INodeTypeBaseDescription`).
* Если `version` — массив, n8n создаёт `nodeVersions` (`NodeHelpers.getVersionedNodeType`),
  и загрузчик берёт `tempNode.currentVersion`; иначе версия = последний элемент массива/число.
* Старые версии навсегда остаются в пакете: workflow, сохранённый на v1, продолжит исполняться на v1.

### 4.2. `description` — минимум

```ts
{
  displayName: 'TrueConf',
  name: 'trueconf',                    // ключ типа: <package>.<name>
  group: ['transform'],                // или ['trigger'] у триггеров
  version: [1],
  description: 'Send messages and manage TrueConf',
  defaults: { name: 'TrueConf' },
  inputs: [NodeConnectionTypes.Main],
  outputs: [NodeConnectionTypes.Main],
  credentials: [{ name: 'trueconfApi', required: true }],
  properties: [ /* INodeProperties[] */ ],
  icon: 'file:trueconf.svg',           // путь относительно .node.js; проверяется на containment
}
```
Для триггера: `group: ['trigger']`, `inputs: []`, `outputs: [NodeConnectionTypes.Main]`.
`inputs`/`outputs` — массив `NodeConnectionType | INodeInputConfiguration` (в 2.x используйте
`NodeConnectionTypes.Main`, строковый enum, а не старый `NodeConnectionType`).

### 4.3. Credentials

```ts
// credentials/TrueconfApi.credentials.ts
import type { ICredentialType, INodeProperties, IAuthenticate, ICredentialTestRequest } from 'n8n-workflow';

export class TrueconfApi implements ICredentialType {
  name = 'trueconfApi';
  displayName = 'TrueConf API';
  documentationUrl = 'https://...';
  icon = 'file:trueconf.svg' as const;      // опционально
  properties: INodeProperties[] = [
    { displayName: 'Server URL', name: 'baseUrl', type: 'string', default: '', required: true },
    { displayName: 'Access Token', name: 'accessToken', type: 'string',
      typeOptions: { password: true }, default: '' },
  ];

  authenticate: IAuthenticate = {                 // применяется к helpers.httpRequestWithAuthentication
    type: 'generic',
    properties: {
      headers: { Authorization: '=Bearer {{$credentials.accessToken}}' },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}/api/v3/server',
      url: '',
      method: 'GET',
    },
  };
}
```
* `authenticate?: IAuthenticate` — либо `{type:'generic', properties:{...}}`, либо функция
  `(credentials, requestOptions) => requestOptions`.
* `test?: ICredentialTestRequest` = `{ request: HttpRequestOptions, rules?: [...] }`; `rules` — правила
  разбора ответа (`IAuthenticateRuleResponseCode` / `...SuccessBody`).
* `extends?: string[]` для наследования базовых кред (например `oAuth2Api`).
* Дополнительно `methods.loadOptions` (см. §4.6) и `preAuthentication`.

### 4.4. Декларативные ноды: `requestDefaults` и `routing`

```ts
description: INodeTypeDescription = {
  ...
  requestDefaults: {
    baseURL: '={{$credentials.baseUrl}}/api/v3',
    headers: { Accept: 'application/json' },
    // ignoreHttpStatusErrors?: boolean, ssl?, proxy?, timeout?
  },
  properties: [
    {
      displayName: 'Resource', name: 'resource', type: 'options', noDataExpression: true,
      default: 'message', options: [{name:'Message', value:'message'}],
    },
    {
      displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
      displayOptions: { show: { resource: ['message'] } }, default: 'send',
      options: [{ name: 'Send', value: 'send', action: 'Send a message', routing: {
        request: { method: 'POST', url: '/messages', body: { text: '={{$parameter.text}}' } },
        output: { postReceive: [ /* ... */ ] },      // опционально
      }}],
    },
  ],
};
```
* `routing?: INodePropertyRouting` на уровне option или property: `{ request?, send?, output?, operations?, ... }`.
* Для декларативных нод **нельзя** задавать `execute`/`trigger`/`webhook`/`polling` — иначе n8n не добавит
  общие `requestOptions` (batching/timeout/proxy/SSL) — см. `applyDeclarativeNodeOptionParameters`.
* `polling: true` автоматически добавляет в properties параметр `pollTimes`, `supportsCORS: true`
  добавляет `allowedOrigins`.

### 4.5. `execute()` — требования и типичные ошибки

```ts
async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
  const items = this.getInputData();
  const out: INodeExecutionData[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      const resp = await this.helpers.httpRequest({                 // простое
        url: `${base}/messages`, method: 'POST', body: {...}, json: true,
        headers: { Authorization: `Bearer ${token}` },
      });
      // или с автоматической подстановкой кред: this.helpers.httpRequestWithAuthentication('trueconfApi', {...})
      out.push(...this.helpers.returnJsonArray(resp));
    } catch (error) {
      if (this.continueOnFail()) {          // параметр "Continue On Fail" из настроек ноды
        out.push({ json: { error: (error as Error).message }, pairedItem: i });
        continue;
      }
      throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
    }
  }
  return [out];                              // ВАЖНО: массив выходов, даже если выход один
}
```
Проверено на живой ноде: `return this.helpers.returnJsonArray([...])` (без внешнего массива)
даёт `TypeError: outputData.entries is not a function or its return value is not iterable`
в `WorkflowExecute.assignPairedItems`. Всегда `return [items]` (тип `INodeExecutionData[][]`).

`helpers` в контексте: `httpRequest`, `httpRequestWithAuthentication`, `requestWithAuthenticationPaginated`,
`returnJsonArray`, `prepareBinaryData`, `getBinaryDataBuffer`, SSH-tunnel, `registerCron`
(`SchedulingFunctions`). Для кред в ноде: `await this.getCredentials('trueconfApi', itemIndex?)`.

### 4.6. `methods.loadOptions`

```ts
methods = {
  loadOptions: {
    async getChats(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
      const creds = await this.getCredentials('trueconfApi');
      const chats = await this.helpers.httpRequest({ url: `.../chats`, json: true, headers: {...} });
      return chats.map((c: any) => ({ name: c.name, value: c.id }));
    },
  },
} satisfies INodeType['methods'];
```
Список имён методов публикуется в `description.__loadOptionsMethods` (n8n делает это сам в
`addLoadOptionsMethods`) — отдельных объявлений в `description` не нужно.

### 4.7. Триггер с долгоживущим WebSocket

Контракт `trigger()` (проверено по `interfaces.d.ts` 2.47.2):

```ts
interface ITriggerResponse {
  closeFunction?: CloseFunction;                       // () => Promise<void>
  manualTriggerFunction?: () => Promise<void>;
  manualTriggerResponse?: Promise<INodeExecutionData[][]>;
}
interface ITriggerFunctions extends FunctionsBase {
  emit(data: INodeExecutionData[][], responsePromise?, donePromise?, deduplicationKey?): void;
  saveFailedExecution(error: ExecutionError): void;    // 2.x: ошибка выполнения — workflow остаётся активным
  emitError(error: Error, responsePromise?): void;     // 2.x: ФАТАЛЬНАЯ ошибка — деактивация + error workflow + backoff-реактивация
  helpers: RequestHelperFunctions & BaseHelperFunctions & ...;
}
```
`FunctionsBase` даёт `logger`, `getCredentials`, `getWorkflowStaticData`, `getMode`, `getNode`,
`getExecutionId`, `getInstanceBaseUrl` и т.д.

Скелет WS-триггера (переподключение + heartbeat + корректное закрытие):

```ts
async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
  const { baseUrl, accessToken } = await this.getCredentials('trueconfApi') as any;
  const staticData = this.getWorkflowStaticData('node');
  const manual = this.getMode() === 'manual';

  let ws: WebSocket | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let closed = false;
  const queue: IDataObject[] = [];

  const connect = () => new Promise<void>((resolve, reject) => {
    ws = new WebSocket(`wss://${baseUrl}/ws?token=${accessToken}`);
    ws.on('open', () => { staticData.lastError = undefined; resolve(); });
    ws.on('message', (raw) => {
      for (const event of parse(raw)) {
        if (manual) { queue.push(event); continue; }
        this.emit([[{ json: event }]]);      // ВАЖНО: [[ ... ]]
      }
    });
    ws.on('error', (err) => {
      // Не бросать из колбэка: соединение переподключаем сами
      this.logger.warn(`TrueConf WS error: ${String(err)}`);
      if (!manual) this.saveFailedExecution(new ExecutionError(String(err)));  // 2.x
      reject(err);
    });
    ws.on('close', (code) => {
      if (closed) return;
      staticData.retry = Math.min((Number(staticData.retry) || 0) + 1, 7);
      const delay = Math.min(30_000, 1000 * 2 ** Number(staticData.retry));
      setTimeout(() => void connect().catch(() => {}), delay);
    });
  });

  await connect();
  heartbeat = setInterval(() => ws?.ping?.(), 25_000);

  // closeFunction вызывается при деактивации/остановке workflow — здесь всё освобождаем
  const closeFunction = async () => {
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    ws?.removeAllListeners();
    ws?.close();
  };

  // Ручной запуск («Execute workflow» в редакторе): поднять соединение, дождаться первого события
  const manualTriggerFunction = async () => {
    await connect();
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (queue.length > 0) { clearInterval(t); resolve(); }
      }, 100);
    });
    this.emit([queue.splice(0).map((json) => ({ json }))]);
  };

  return { closeFunction, manualTriggerFunction };
}
```
Практика:
* `emit` асинхронный по смыслу (создаёт execution) — при большом потоке событий нужен собственный
  backpressure/очередь; `deduplicationKey` (4-й аргумент) помогает дедуплицировать повторы.
* Ошибки, после которых соединение жить не может (401, DNS, отказ TLS) — `emitError()`: n8n деактивирует
  workflow, прогонит error workflow и будет реактивировать с backoff. Ошибки обработки одного события —
  `saveFailedExecution()`, workflow остаётся активным.
* `manualTriggerFunction` + `manualTriggerResponse` — только для кнопки теста; в manual-режиме не нужно
  «долго висящее» соединение: уберите его в `closeFunction` после первого события.
* Таймеры/сокеты обязательно закрывать в `closeFunction` — иначе после деактивации останутся висеть
  handles (и n8n не сможет корректно остановиться).

### 4.8. `poll()`-триггеры

```ts
description: INodeTypeDescription = {
  group: ['trigger'], polling: true, inputs: [], outputs: [NodeConnectionTypes.Main],
  properties: [ /* вместе с pollTimes, который добавит n8n */ ],
};

async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
  const staticData = this.getWorkflowStaticData('node');
  const budget = this.getPollBudgetMs();                      // 2.x: сколько времени есть на тик
  const events = await fetchSince(staticData.lastTs ?? 0, budget);
  if (!events.length) return null;                            // null = «ничего нового»
  staticData.lastTs = events.at(-1)!.ts;
  return [events.map((e) => ({ json: e }))];
}
```
`pollTimes` — параметр `fixedCollection` (default `everyMinute`), добавляется автоматически при
`polling: true`. `IPollFunctions` в 2.x содержит `__emit`, `getPollBudgetMs`, `__emitError`,
`__commitCursor`/`__runPoll` (служебные, нода их не вызывает).

### 4.9. Разрешение `n8n-workflow` в рантайме (важно для версий)

Проверено экспериментом внутри загруженной ноды:

```
n8nWorkflowVersion: "2.47.2"
resolvedFrom: /opt/n8n/lib/node_modules/n8n/node_modules/n8n-workflow/dist/cjs/index.js
```
Механизм: `LoadNodesAndCredentials.init()` делает
`process.env.NODE_PATH = [module.paths.join(':'), process.env.NODE_PATH].join(':')` + `_initPaths()`.
Поэтому `require('n8n-workflow')` из кода community-ноды всегда попадает в версию, встроенную в n8n
(2.47.2), а `peerDependencies: {"n8n-workflow": "*"}` — это декларация, а не контракт проверки версии.
Следствие: **не** кладите `n8n-workflow` в `node_modules` пакета (два экземпляра = сломанные `instanceof`
и «странные» ошибки), и не полагайтесь на `n8n-core`/`@n8n/*` из своего `dependencies`.

---

## 5. Песочница task runner и что доступно коду ноды

Состояние на сервере: `N8N_RUNNERS_MODE` не задан → `TaskRunnersConfig.mode = 'internal'` (дефолт в
`@n8n/config`), поэтому в `ps` видно два процесса: `n8n start` (main) и `n8n task-runner` (runner,
запускаемый лончером внутри той же машины/инсталляции, отличается от `external`-режима).

**Подтверждено: код обычной ноды исполняется в основном процессе n8n, а не в task runner.**
Доказательства:
1. Код: task runner используют только Code-нода и Python — `n8n-nodes-base/dist/nodes/Code/Code.node.js`
   создаёт `JsTaskRunnerSandbox`/`PythonTaskRunnerSandbox`; в `dist/workflow-execute*.js` маршрутизации
   «нода → раннеру» нет.
2. Эксперимент: нода вернула `pid`, `argv1` и `require.resolve`, загрузившись как обычная community-нода:
   ```
   "pid": 17039, "argv1": "/opt/n8n/bin/n8n", "node": "v26.13.1",
   "hasFs": "function",                       # require('node:fs') доступен
   "resolvedFrom": "/opt/n8n/lib/node_modules/n8n/node_modules/n8n-workflow/dist/cjs/index.js"
   ```
   Т.е. это процесс `bin/n8n`, а не `task-runner`.

Практические следствия для TrueConf-ноды (WS + HTTP):

* Доступно всё: `fs`, `net`/`tls`, `http(s)`, `child_process`, `worker_threads`, нативные аддоны,
  переменные окружения процесса n8n (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` на этом сервере — доступ к
  `process.env` из ноды разрешён; впрочем, читать секреты из env всё равно не стоит).
* Ограничения раннера (`--disable-proto`, урезанный `require`, лимит памяти, таймаут задачи) к обычным
  нодам **не применяются**. Именно поэтому долгоживущий WebSocket в `trigger()` работает.
* Цена: падение/утечка в ноде роняет весь main-процесс. Для WS-триггера обязательны аккуратные
  reconnect/close и запрет на `throw` из сетевых колбэков.
* Если нода хочет использовать Code-ноду-подобную изоляцию — это не поддерживается для community-nodes:
  раннер умеет исполнять только код Code-ноды, не произвольный код ноды.
* Внутренний режим раннера годится только для отладки (лог самого n8n при старте Python-раннера:
  «Launching a Python runner in internal mode is intended only for debugging and is not recommended for
  production»). Для JS-нод это не важно, но если появятся workflow с Python-кодом — нужен `external`.

---

## 6. Приложение: сырые доказательства с сервера

**A. Загрузка локального пакета без записи в БД** (изолированный инстанс
`N8N_USER_FOLDER=/tmp/n8nprobe`, sqlite, `n8n execute --id <wf>`; в БД `installed_packages = 0` строк,
`installed_nodes = 0`):

```
11:53:22.909 debug Lazy-loading nodes and credentials from n8n-nodes-base { "nodes": 501 }
11:53:22.927 debug Can't enable lazy-loading
11:53:22.929 debug No codex available for: dshProbe
11:53:22.929 debug Loaded all credentials and nodes from n8n-nodes-dshprobe { "credentials": 0, "nodes": 1 }
...
"status": "success", "lastNodeExecuted": "DSH Probe"
```

**B. Несовместимая версия API нод** (`n8n.n8nNodesApiVersion: 2`):

```
Skipping package "n8n-nodes-dshprobe": it requires node API version 2.0, but this n8n version supports up to 1.0. Upgrade n8n to use this package, or uninstall it in Settings > Community nodes.
...
UnrecognizedNodeTypeError: Unrecognized node type: n8n-nodes-dshprobe.dshProbe
    at LoadNodesAndCredentials.getNode (.../src/load-nodes-and-credentials.ts:713:10)
```

**C. Каталог расширений** (`N8N_CUSTOM_EXTENSIONS=/tmp/n8nprobe/customext`, пакет в
`customext/node_modules/n8n-nodes-dshprobe`) — нода найдена и исполнена как `CUSTOM.dshProbe`
(status success), т.е. путь «каталог расширений» рабочий и не требует ledger.

**D. npm-ловушка** (`npm 11.20.0`, пакет с `peerDependencies: {n8n-workflow: "*"}`):

```
$ npm install --omit=dev --audit=false ... --install-strategy=shallow
added 93 packages in 8s
n8n-workflow installed? YES      # 60M node_modules
# после удаления peerDependencies (как делает сам n8n):
n8n-workflow installed? NO
```

**E. npm под юзером n8n сломан** (глобальный cache из `/usr/local/etc/npmrc`):

```
$ sudo -u n8n npm view n8n-nodes-mcp version
npm error code EACCES ... /var/cache/npm/_cacache/tmp/...
npm error To permanently fix this problem, please run: sudo chown -R 985:965 "/var/cache/npm"
```

**F. Состояние прода после исследования**: `/var/lib/n8n/.n8n/nodes/` содержит только
`package.json` (`{"name":"installed-nodes","private":true,"dependencies":{}}`), каталог
`node_modules` отсутствует, `installed_packages`/`installed_nodes` пусты, `journalctl -u n8n` не содержит
строк про community-пакеты. Тестовая нода (пакет `n8n-nodes-dshprobe`) создавалась **только** в
изолированном `N8N_USER_FOLDER=/tmp/n8nprobe` и удалена; в прод ничего не устанавливалось, сервис
не перезапускался.
