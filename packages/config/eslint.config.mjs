// 공용 ESLint 설정 (CLAUDE.md §8: 하드코딩·브라우저 기본 대화상자 금지 규칙 포함)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', '.next/**', 'node_modules/**', 'drizzle/**', 'next-env.d.ts', '*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 05 §6.6: 브라우저 기본 alert/confirm/prompt 금지
      'no-restricted-globals': ['error', 'alert', 'confirm', 'prompt'],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'alert' },
        { object: 'window', property: 'confirm' },
        { object: 'window', property: 'prompt' },
      ],
    },
  },
);
