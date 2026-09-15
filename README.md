# Netflix Top 10 for Lampa — Native Cards

Готовый плагин для Lampa, который добавляет отдельный пункт **Netflix** и показывает официальный Netflix Top 10 **нативными постер-карточками Lampa**.

## Что делает версия 1.0.0

- отдельная кнопка **Netflix** в левом меню;
- полноценные постеры вместо текстового списка;
- красные бейджи **#1 ... #10** прямо на карточках;
- отдельный ряд **Top 10 фильмов**;
- отдельный ряд **Top 10 сериалов**;
- по нажатию открывается обычная полная карточка Lampa;
- название, постер, рейтинг, год и фон берутся из встроенного TMDB-источника Lampa;
- **никакой отдельный TMDB API key не нужен**;
- рейтинг берётся из официальных публичных файлов Netflix Tudum;
- выбор страны в настройках;
- автоматическое обновление через GitHub Actions;
- GitHub Action коммитит JSON только когда рейтинг реально изменился;
- локальный кэш сопоставлений Netflix → TMDB, поэтому после первого открытия раздел загружается быстрее;
- основной интерфейс рассчитан на Lampa 3.x (`Lampa.Maker`), есть fallback для старых сборок.

## Доступные регионы

- Украина
- США
- Великобритания
- Польша
- Германия
- Франция
- Испания
- Италия
- Канада
- Япония
- Южная Корея
- Global

Для **Global** используются четыре официальные глобальные таблицы Netflix:

- Films (English)
- Films (Non-English)
- TV (English)
- TV (Non-English)

Они не смешиваются в выдуманный единый глобальный рейтинг.

## Откуда берутся данные

Рейтинг:

- `https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv`
- `https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv`

Метаданные и постеры:

- встроенный TMDB-источник самой Lampa.

Схема:

```text
Netflix Tudum TSV
        ↓
GitHub Action
        ↓
data/top10.json
        ↓
Lampa plugin
        ↓
Lampa built-in TMDB search
        ↓
native Lampa poster cards
```

## Структура архива

```text
.github/
  workflows/
    update-netflix.yml
data/
  top10.json
scripts/
  update_netflix.py
.nojekyll
netflix-top10.js
README.md
```

## Установка

### 1. Создать репозиторий

Создай на GitHub новый публичный репозиторий, например:

```text
lampa-netflix-top10
```

Не добавляй отдельный README или `.gitignore`.

### 2. Загрузить содержимое архива

Распакуй ZIP и загрузи **содержимое**, а не сам ZIP.

В корне GitHub должны быть:

```text
.github
data
scripts
.nojekyll
netflix-top10.js
README.md
```

### 3. Запустить получение рейтинга

Открой:

```text
Actions → Update Netflix Top 10
```

Выбери:

```text
Run workflow → Run workflow
```

После зелёной галочки открой:

```text
data/top10.json
```

Там должно быть:

```json
"generated": true
```

и массивы стран с `movies` и `tv`.

### 4. Включить GitHub Pages

Открой:

```text
Settings → Pages
```

Поставь:

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

Нажми **Save**.

### 5. Получить ссылку плагина

Она будет такой:

```text
https://USERNAME.github.io/lampa-netflix-top10/netflix-top10.js
```

Плагин сам вычисляет адрес расположенного рядом:

```text
data/top10.json
```

Ничего в коде менять не нужно.

### 6. Установить в Lampa

```text
Настройки → Расширения → Добавить плагин
```

Вставь URL `netflix-top10.js`.

Полностью перезапусти Lampa.

После этого в левом меню должен появиться пункт:

```text
Netflix
```

## Выбор страны

```text
Настройки → Netflix Top 10 → Регион рейтинга
```

По умолчанию выбрана Украина.

## Первое открытие раздела

В `top10.json` хранятся названия и позиции Netflix, но не чужие постеры.

При первом открытии Lampa сопоставляет 20 названий с TMDB через **свой встроенный TMDB API**. Это может быть чуть медленнее первого раза.

Результаты кэшируются локально примерно на 14 дней.

Если какое-то название сопоставилось неверно:

```text
Настройки → Netflix Top 10 → Очистить кэш постеров
```

После этого Lampa выполнит поиск заново.

## Обновление

GitHub Action проверяет официальный Netflix dataset раз в сутки.

Netflix публикует недельные рейтинги, поэтому если рейтинг не поменялся — новый commit не создаётся.

Компьютер держать включённым не нужно.

## Проверка

В браузере должны открываться обе ссылки:

```text
https://USERNAME.github.io/lampa-netflix-top10/netflix-top10.js
```

```text
https://USERNAME.github.io/lampa-netflix-top10/data/top10.json
```

Во второй должно быть:

```json
"generated": true
```

## Техническая заметка

Lampa 3.0 перевела UI на модульный API `Lampa.Maker`. Плагин использует его в первую очередь.

Для старых сборок оставлен fallback через `Lampa.InteractionMain`.
