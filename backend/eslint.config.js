import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // src/generated: cliente generado por Codama (npm run codegen); no se edita a mano.
  { ignores: ['node_modules/**', 'dist/**', 'src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Scripts de mantenimiento: Node puro, sin analisis de tipos.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly' } },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['error', 'warn'] }],
      eqeqeq: 'error',
    },
  },
);
