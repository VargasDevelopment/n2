import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '.data/**', 'eslint.config.mjs']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Function complexity is enforced by the per-function code-health baseline.
      complexity: 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error'
    }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    // Web source guards; one block, because a later no-restricted-syntax would replace this one.
    // Viewport: any move not written through writeOwnViewport counts as the person's, and ends a
    // navigation. These are the ways to move it without that writer, so only viewportAuthorship.ts,
    // which defines it, may call them. The match is by method name,
    // not by type: an unrelated `chart.setCenter()` would be flagged, and computed access such as
    // `flow['fitView']()` slips past. Scoping it to React Flow instances needs typed linting.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', 'apps/web/src/viewportAuthorship.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='fitView']",
          message:
            'React Flow would write this fit itself, which reads as the person moving the viewport. Use useCanvasFirstFit.'
        },
        {
          selector:
            'CallExpression > MemberExpression.callee[property.name=/^(setViewport|fitView|fitBounds|setCenter|zoomIn|zoomOut|zoomTo|panBy)$/]',
          message:
            "Move the viewport through writeOwnViewport, so it is not mistaken for the person's move."
        },
        // TanStack sets these when a refresh fails over data it keeps, so branching on them hides
        // usable data behind an error. Matched by name, so a mutation's isError is caught too.
        {
          selector:
            'MemberExpression:matches([property.name=/^(isError|isLoadingError|isRefetchError)$/], [property.value=/^(isError|isLoadingError|isRefetchError)$/])',
          message:
            'Read query state through queryView: block only without data, report a failed refresh beside it.'
        },
        {
          selector:
            'ObjectPattern > Property:matches([key.name=/^(isError|isLoadingError|isRefetchError)$/], [key.value=/^(isError|isLoadingError|isRefetchError)$/])',
          message:
            'Read query state through queryView: block only without data, report a failed refresh beside it.'
        }
      ]
    }
  }
);
