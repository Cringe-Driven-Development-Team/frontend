# Синхронизация с макетом Figma — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести уже реализованные токены, компоненты и экраны клиента до макета v33.

**Architecture:** Правки в CSS Modules и токенах, два маленьких расширения API
(`Input.invalid`, `Modal.description`, `StateBlock.actionsClassName`). Поведение не меняется,
кроме подсветки логина при неверных учётных данных.

**Tech Stack:** `@cdd-team/react`, CSS Modules, bun, turbo, oxlint, oxfmt, tsc.

**Spec:** `docs/superpowers/specs/2026-10-19-figma-sync-design.md`

## Global Constraints

- Только то, что уже есть в коде; новые фичи из макета не делать.
- Не трогать: кнопку удаления ячейки, чипы под ячейками, «Блокнот не найден», тост `info`.
- Без внешних библиотек. CSS Modules, короткие camelCase-классы, алиасы импортов.
- Каждому экспорту — JSDoc без типов в `@param`/`@returns`; новые пропы — с JSDoc-комментарием.
- Чужие классы компонент не стилизует — класс передаётся пропом.
- Юнит-тестов в клиенте нет, правки визуальные: проверка задачи — `bun run check`,
  `bun run build` и осмотр в `bun run dev`. TDD здесь неприменим.
- Коммиты — на русском, в стиле репозитория (`feat:`, `fix:`, `style:`), с trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Логин без текста ошибки при `invalid_credentials`: рамка красная, `aria-invalid="true"`,
   под полем пустая строка 20 px; при вводе в любое поле подсветка снимается.
2. Переезд луны вход ↔ регистрация: без скачка в начале и конце (меняется только `transform`).
3. Узкий экран ≤ 860 px на /login и /register выглядит как до правок (луна 600 px).
4. Модалка без `description` («Новый блокнот») — отступы как раньше.
5. `prefers-reduced-motion` — луна переключается без анимации, как раньше.

Пункты 1–5 проверяются в шагах осмотра задач 3 и 4.

---

### Task 1: Токены, тени и стекло

**Files:**
- Modify: `apps/client/src/styles/tokens.css`
- Modify: `apps/client/src/components/NotebookCard/NotebookCard.module.css`
- Modify: `apps/client/src/components/StateBlock/StateBlock.module.css`

**Interfaces:**
- Produces: `--code-keyword`, `--code-number`, `--blur-glass`; новые значения
  `--shadow-glow-primary`, `--shadow-glow-primary-hover`, `--shadow-popover`.

- [ ] **Step 1:** В `tokens.css` заменить три тени значениями из спеки (раздел 1, таблица) и
  добавить `--code-keyword: #b79bff;`, `--code-number: #ffc98a;` в блок «Код» и
  `--blur-glass: blur(20px);` в блок «Эффекты».
- [ ] **Step 2:** В `NotebookCard.module.css` `.keyword` → `var(--code-keyword)`, `.number` →
  `var(--code-number)`; в `.card` добавить `backdrop-filter: var(--blur-glass);`.
- [ ] **Step 3:** В `StateBlock.module.css` в `.block` добавить `backdrop-filter: var(--blur-glass);`.
- [ ] **Step 4:** `bun run check && bun run build` — оба без ошибок.
- [ ] **Step 5:** `bun run dev`, осмотреть: кнопка «Новый блокнот» (свечение слабее), меню профиля,
  модалка, снекбар, тост, карточка входа — у всплывающих появился фиолетовый ореол;
  карточки и заглушка размывают фон (звёзды под ними нечёткие).
- [ ] **Step 6:** Commit `style: тени, стекло и цвета кода из макета`.

### Task 2: Отступы модалок, заглушек и колонки блокнота

**Files:**
- Modify: `apps/client/src/components/Modal/Modal.tsx`, `Modal.module.css`
- Modify: `apps/client/src/components/ProfileMenu/LogoutDialog.tsx`, `ProfileMenu.module.css`
- Modify: `apps/client/src/pages/NotebooksPage/NotebooksPage.module.css`
- Modify: `apps/client/src/components/StateBlock/StateBlock.tsx`, `StateBlock.module.css`
- Modify: `apps/client/src/pages/NotebookPage/NotebookPage.tsx`, `NotebookPage.module.css`

**Interfaces:**
- Produces: `ModalProps.description?: string` — текст под заголовком;
  `StateBlockProps.actionsClassName?: string` — класс для блока кнопок.

- [ ] **Step 1:** `Modal`: заголовок и необязательное описание обернуть в `<div className={styles.head}>`
  (`display: flex; flex-direction: column; gap: 8px;`); описание — `<p id="modal-description">`
  с `color: var(--color-text-secondary)`, на `dialog` — `aria-describedby`, если описание есть.
  `padding-right: 44px` перенести с `.title` на `.head`. У `.modal` gap 24 остаётся.
- [ ] **Step 2:** `LogoutDialog`: текст «Блокноты сохранятся — войдите снова, чтобы продолжить работу.»
  передать в `description`, убрать `<p>` и обёртку `.dialog`; удалить неиспользуемые
  `.dialog`, `.dialogText` из `ProfileMenu.module.css`. `.dialogActions` gap → 12px.
- [ ] **Step 3:** `NotebooksPage.module.css`: `.createActions` gap → 12px.
- [ ] **Step 4:** `StateBlock`: `.actions` gap → 12px; добавить проп `actionsClassName`, склеить через
  `clsx`. В `NotebookPage` пустой блокнот передаёт `styles.chips` (`gap: 8px`).
- [ ] **Step 5:** `NotebookPage.module.css`: новый класс `.column { width: 100%; max-width: 792px;
  margin: 0 auto; }` — на `div.body` (ячейки + чипы) и на `ul` скелетонов (`clsx(styles.cells,
  styles.column)`); `.cells` gap → 24px.
- [ ] **Step 6:** `bun run check && bun run build`.
- [ ] **Step 7:** Осмотр: «Выйти из аккаунта?» — описание в 8 px под заголовком, кнопки через 12;
  «Новый блокнот» без описания — как раньше; заглушка «Блокнотов пока нет» — кнопка;
  блокнот — колонка 792 px по центру, ячейки через 24, скелетоны той же ширины, пустой
  блокнот — чипы через 8.
- [ ] **Step 8:** Commit `style: отступы модалок, заглушек и колонка ячеек по макету`.

### Task 3: Ошибки входа и регистрации

**Files:**
- Modify: `apps/client/src/components/Input/Input.tsx`
- Modify: `apps/client/src/pages/AuthPage/AuthForm.tsx`
- Modify: `apps/client/src/utils/credentials.ts`

**Interfaces:**
- Produces: `InputProps.invalid?: boolean` — состояние ошибки без текста: красная рамка,
  `aria-invalid`, строка сообщения пустая (подсказка `hint` не показывается).

- [ ] **Step 1:** `Input`: `const isInvalid = Boolean(error) || invalid;` — им заменить проверки
  для класса `styles.error` и `aria-invalid`; текст и иконка ошибки по-прежнему только при `error`.
  При `invalid` без `error` строка сообщения пустая.
- [ ] **Step 2:** `AuthForm`: в `case 'invalid_credentials'` дополнительно помечать логин. Хранить
  флаг рядом с `serverErrors` (например, `serverErrors.login = ''` не годится — пустая строка
  ложна; завести `const [credentialsRejected, setCredentialsRejected] = useState(false)`),
  сбрасывать там же, где `setServerErrors({})`. Логину передавать `invalid={credentialsRejected}`.
- [ ] **Step 3:** `credentials.ts`: `login_taken` → `'Этот логин уже занят. Войдите или выберите другой'`.
- [ ] **Step 4:** `bun run check && bun run build`.
- [ ] **Step 5:** Осмотр с бэкендом (`bun run dev`): вход с неверным паролем — оба поля красные,
  сообщение только под паролем, у логина `aria-invalid="true"` (DevTools); ввод символа в любое
  поле снимает подсветку с обоих. Регистрация занятого логина — новый текст.
- [ ] **Step 6:** Commit `fix: подсветка полей и тексты ошибок входа по макету`.

### Task 4: Карточка входа и луна

**Files:**
- Modify: `apps/client/src/pages/AuthPage/AuthPage.module.css`
- Modify: `apps/client/src/pages/AuthPage/AuthPage.tsx`

- [ ] **Step 1:** Половины 50/50: `.formPane` и `.side` → `flex: 1 1 0`.
- [ ] **Step 2:** Луна 660 px только на десктопе: масштаб `1.1` от центра, без смены
  `transform-origin` (иначе переезд скачет). Центр луны должен оказаться в `50cqw ± 330px`:
  ```css
  .moon          { transform: translateX(calc(50cqw + 30px)) scale(1.1); }   /* вход: левый край на середине */
  .register .moon { transform: translateX(calc(50cqw - 630px)) scale(1.1); } /* регистрация: правый край на середине */
  ```
  `left: 0`, `top: 50%`, `margin-top: -300px` и `transition` не меняются. Медиа-запрос
  ≤ 860 px уже сбрасывает `transform: none` — луна там остаётся 600 px. Обновить комментарий над `.moon`.
- [ ] **Step 3:** Лицевая сторона: в `AuthPage.tsx` обернуть заголовок и текст в
  `<div className={styles.faceCopy}>` (`display: flex; flex-direction: column; gap: 8px;`),
  у `.face` gap → 24px. У `.facePitch` убрать `white-space: pre-line`, задать `width: 300px;
  max-width: 100%`.
- [ ] **Step 4:** Тексты `facePitch` — точно из спеки, раздел 3: на входе «Cellestial — блокноты
  с Python прямо в браузере. Пишите код и заметки в ячейках, запускайте их и сразу видите
  результат. Ничего не нужно устанавливать.», на регистрации «Войдите, чтобы вернуться к своим
  блокнотам. Код и заметки сохраняются автоматически — продолжите с того места, где остановились.»
- [ ] **Step 5:** `bun run check && bun run build`.
- [ ] **Step 6:** Осмотр /login и /register на 1440 px: края луны на середине карточки, внешние
  углы карточки закрыты луной, текст на луне не вылезает за её край. Переезд туда-обратно —
  плавный, без скачка. Ширина 800 px — раскладка как до правок. Эмуляция
  `prefers-reduced-motion` — переключение без анимации.
- [ ] **Step 7:** Commit `style: карточка входа и луна по макету`.

### Task 5: Финальная проверка

- [ ] **Step 1:** `bun run check && bun run build` на всей ветке.
- [ ] **Step 2:** Пройти все экраны из спеки на 1440 px и сверить со скриншотами Drafts в Figma;
  размытие `blur(20px)` сверить на глаз со стеклом шапки/карточек в макете, при явном
  расхождении подобрать значение в `--blur-glass`.
- [ ] **Step 3:** Push `web-52`, PR в `Cringe-Driven-Development-Team/frontend` с `Closes #52`
  — только после команды человека.
