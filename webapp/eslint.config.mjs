import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  // Replace the default ignores from eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'public/demo/**',
    '.demo-build-tmp/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      curly: ['error', 'all'],
      '@next/next/no-img-element': 'off', // Media goes through our API route so we can serve it dynamically.
      'react/jsx-sort-props': [
        'error',
        {
          callbacksLast: true,
          shorthandLast: true,
          ignoreCase: true,
          noSortAlphabetically: true,
          reservedFirst: true,
        },
      ],
      'sort-imports': [
        'error',
        {
          ignoreCase: true,
          ignoreDeclarationSort: true,
        },
      ],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling'], 'index', 'object', 'type'],
          pathGroups: [
            {
              pattern: 'react',
              group: 'builtin',
              position: 'before',
            },
            {
              pattern: '@/components/**',
              group: 'internal',
              position: 'before',
            },
            {
              pattern: '@/hooks/**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['react'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },
  {
    files: [
      'src/pages/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/sections/**/*.{ts,tsx}',
      'src/context/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
    ],
    ignores: [
      'src/pages/api/**',
      'src/components/modals/SetupModal.tsx',
      'src/components/modals/setup/**',
      'src/components/FileExplorer.tsx',
      'src/hooks/useIngestion.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="fetch"][arguments.0.type="Literal"][arguments.0.value=/^\\/api\\//]',
          message: 'Use apiFetch from "@/lib/client/apiClient" instead of raw fetch("/api/...") so Demo Mode works.',
        },
        {
          selector:
            'CallExpression[callee.name="fetch"][arguments.0.type="TemplateLiteral"][arguments.0.quasis.0.value.raw=/^\\/api\\//]',
          message: 'Use apiFetch from "@/lib/client/apiClient" instead of raw fetch(`/api/...`) so Demo Mode works.',
        },
      ],
    },
  },
]);

export default eslintConfig;
