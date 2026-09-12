// ─────────────────────────────────────────────────────────────────────────────
// ESLint для EatAps.
//
// ЦЕЛЬ — НАХОДИТЬ БАГИ, А НЕ СПОРИТЬ О КАВЫЧКАХ.
//
// Стилистических правил здесь намеренно почти нет. Проект написан ровно, а
// сотня правил про пробелы дала бы тысячи замечаний, среди которых настоящие
// находки просто утонут — и линтер начнут отключать целиком.
//
// Что действительно важно и включено на уровне ошибки:
//   • rules-of-hooks — хук в условии ломает React молча и не всегда сразу;
//   • no-undef / no-unused-vars — опечатки в именах;
//   • no-cond-assign, no-fallthrough, eqeqeq — классические тихие ошибки;
//   • правила React про ключи и небезопасную разметку.
//
// exhaustive-deps оставлен предупреждением, а не ошибкой. Это сознательно:
// в этом проекте несколько эффектов намеренно не следят за всеми
// зависимостями (подписки, которые нельзя пересоздавать на каждый рендер), и
// каждое такое место снабжено локальным отключением с объяснением. Превращать
// правило в ошибку значит либо наплодить отключений, либо сломать подписки.
import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'audit/**', 'supabase/**', '.vercel/**'],
  },

  // ── Клиент: браузер + React ────────────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        __APP_VERSION__: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18.3' } },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // Проект не использует новый JSX-трансформ в исходниках? Использует —
      // React в область видимости импортировать не нужно.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      // Типы пропсов в проекте не описываются, и заводить их сейчас — отдельная
      // задача, не связанная с безопасностью.
      'react/prop-types': 'off',
      // Кавычки-апострофы в русском тексте — это нормальный текст, а не ошибка.
      'react/no-unescaped-entities': 'off',

      // Настоящие ошибки.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-key': 'error',
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        // `const { id, ...rest } = x` — принятый в проекте способ ОТБРОСИТЬ
        // поле. Это не забытая переменная, а намерение.
        ignoreRestSiblings: true,
      }],
      // `catch {}` в проекте означает «эта операция необязательна»: вибрация,
      // запись в localStorage, отписка от канала. Такие места прокомментированы,
      // и требовать от них фиктивной обработки — вредный шум. Пустые блоки
      // ЛЮБОГО другого вида остаются ошибкой.
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-cond-assign': ['error', 'except-parens'],
      'no-fallthrough': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
      'no-unsafe-optional-chaining': 'error',
      'no-constant-binary-expression': 'error',
      'require-atomic-updates': 'off',
    },
  },

  // ── Сервер: Node ───────────────────────────────────────────────────────────
  {
    files: ['api/**/*.js', 'scripts/**/*.mjs', '*.js', '*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-cond-assign': ['error', 'except-parens'],
      'no-unsafe-optional-chaining': 'error',
      'no-constant-binary-expression': 'error',
      // Серверный код обязан писать в лог: это единственный способ разобраться
      // в сбое на бессерверной платформе.
      'no-console': 'off',
    },
  },

  // ── Тесты ──────────────────────────────────────────────────────────────────
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
]
