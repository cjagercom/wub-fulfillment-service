// eslint.config.js (Flat Config, ESLint 9+)
import js from '@eslint/js'
import * as tseslint from 'typescript-eslint'
import prettierPlugin from 'eslint-plugin-prettier'
import importX from 'eslint-plugin-import-x'
import unusedImports from 'eslint-plugin-unused-imports'
import pluginN from 'eslint-plugin-n'
import pluginPromise from 'eslint-plugin-promise'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

export default [
  // Baseline JS
  js.configs.recommended,

  // TypeScript (non type-checked voor snelheid; kun je wisselen naar type-checked als je wil)
  ...tseslint.configs.recommended,
  tseslint.configs.disableTypeChecked,

  // Globale ignores
  {
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      '.react-router/**/*', // mocht dit per ongeluk bestaan
    ],
  },

  // Project rules
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        // Node-achtige globals; alternatief is plugin-n’s recommended settings
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
    plugins: {
      prettier: prettierPlugin,
      import: importX,
      'unused-imports': unusedImports,
      n: pluginN,
      promise: pluginPromise,
    },
    settings: {
      // import-x + TS resolver
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
        }),
      ],
    },
    rules: {
      // Formatter handhaving
      'prettier/prettier': 'error',

      // Node best practices
      'n/no-missing-import': 'off', // door TS resolver
      'n/no-unsupported-features/es-builtins': 'off',
      'n/no-unsupported-features/node-builtins': 'off',

      // Promise hygiene
      'promise/always-return': 'off',
      'promise/no-nesting': 'off',
      'promise/no-new-statics': 'error',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/catch-or-return': 'off',

      // Imports
      'import/no-unresolved': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
          pathGroups: [
            { pattern: '~/**', group: 'internal' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'never', // jij wil geen lege regels
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // Unused imports/vars
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // TypeScript overrides
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Console
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
]
