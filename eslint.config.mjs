import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'prisma/migrations'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow unused args like `_req` / `_next` (Express needs them in the signature).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // express.d.ts must use `namespace Express` to extend the Request type.
      '@typescript-eslint/no-namespace': 'off',
    },
  },
);
