# Как добавить первый плагин

Пошаговая инструкция для репозитория `trustsoft/CLIHub-plugins`.

## Что понадобится

- Node.js 20+ (`node --version`)
- PowerShell (Windows) для локальной упаковки
- Git и доступ к репозиторию (PR или прямой push в `main`)

## 1. Создай папку плагина

```powershell
cd D:\Projects\CLIHub-plugins
New-Item -ItemType Directory plugins\my-agent
Copy-Item templates\plugin.json plugins\my-agent\plugin.json
```

Имя папки — это `id` плагина. Оно должно совпадать с полем `id` в `plugin.json`.

## 2. Заполни `plugin.json`

Открой `plugins\my-agent\plugin.json` и замени:

- `id` — `my-agent` (ровно как имя папки);
- `name`, `description` — отображаемые название и описание;
- `version` — `major.minor.patch`, например `1.0.0`;
- `publisher` — автор/организация;
- `homepage` — HTTPS-ссылка;
- `minAppVersion` — минимальная версия CLIHub (можно `0.0.0`);
- `releaseNotesUrl` — опционально, HTTPS;
- `commands` — минимум `launch`; остальные (`resume`, `version`, `update`) по возможности;
- `detection` — маркеры установки/проекта;
- `updateCheck` — опционально, источник обновлений агента.

Все объявленные команды будут показаны пользователю в диалоге подтверждения перед установкой, поэтому не прячь ничего в `resume`/`version`/`update`.

## 3. Добавь логотип (опционально)

Положи `logo.png` рядом с `plugin.json`:

```text
plugins\my-agent\
  plugin.json
  logo.png
```

В папке плагина разрешены только `plugin.json` и `logo.png`.

## 4. Собери пакет

```powershell
pwsh scripts\package-plugin.ps1 my-agent
```

Появится `dist\my-agent-1.0.0.clihub-plugin.zip` с верхним каталогом `my-agent/`.
Каталог `dist/` в git не коммитится.

## 5. Проверь перед коммитом

```powershell
node scripts\build-index.mjs --check
```

Проверка валидирует дескриптор, считает SHA-256 пакета и проверяет, что версия не была
опубликована с другим содержимым. Для нового плагина должно быть `Validated 1 plugin(s).`

## 6. Закоммить и отправь

```powershell
git add plugins\my-agent
git commit -m "feat(plugin): add my-agent"
git push
```

Не коммить `dist/` и `index.json` вручную: индекс генерирует workflow после публикации.

## 7. Что произойдёт после push/merge

Workflow `Publish plugin feed`:

1. упакует плагин;
2. проверит дескриптор и immutability;
3. создаст GitHub Release `<id>-<version>` и приложит пакет;
4. обновит `index.json` (SHA-256, `minAppVersion`, `packageUrl`);
5. закоммитит индекс от имени бота.

После этого плагин появится в CLIHub → CLI Agents → **Browse Plugins**.

## Правила версий

- Версия публикуется один раз; перезаписать её нельзя.
- Любое изменение дескриптора или логотипа требует bump `version`.
- Старые версии остаются в Releases для отката, но индекс указывает на последнюю.
- `id` встроенных агентов (`reserved-ids.json`) использовать нельзя.

## Частые ошибки

- `plugin.json id ... must match the folder name` — переименуй папку или поле `id`.
- `missing dist/...` — сначала запусти `scripts\package-plugin.ps1 <id>`.
- `version ... was already published with different content` — подними `version`.
- `id is reserved` — выбери другой id: встроенные агенты уже есть в CLIHub.
- `homepage ... must be an HTTPS URL` — используй `https://`.
