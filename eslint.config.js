import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// The areas below the UI. One array, so a new lower area is a one-line addition here and in
// src/engine/importBoundaries.test.ts.
const LOWER_AREAS = ['engine', 'world', 'sim', 'gacha', 'data', 'render'];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.claude/worktrees'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Import direction: the layers below the UI do not depend on it. src/game.ts, src/main.ts,
    // src/intent.ts, src/strings.ts, src/ui and src/editor are outside this block and stay free to
    // import the UI and each other; src/art and src/testing are left out of the rule too. Tests
    // may cross layers to check a round trip, so *.test.ts is exempt: the boundary is about
    // shipped code. The pattern matches any relative specifier with a `ui` or `editor` directory
    // in it, at any depth (`../ui/minimap`, `../../editor/editor`, `../ui`) and not a file whose
    // name only starts that way (`../world/uiThing`). The rule covers static imports and
    // re-exports (`import`, `import type`, `import 'x'`, `export ... from`, `export * from`)
    // only; a dynamic `import()` or a `require()` is not seen by it.
    files: [`src/{${LOWER_AREAS.join(',')}}/**/*.ts`],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.{1,2}/(?:.*/)?(?:ui|editor)(?:/|$)',
              message: `The layers below the UI (${LOWER_AREAS.join(', ')}) do not depend on the UI or the editor. Pass the value in as an argument, or move the shared code down into the layer that uses it.`,
            },
          ],
        },
      ],
    },
  },
  {
    // Node-side tooling and the build configs.
    files: ['tools/**/*.{mjs,js,ts}', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
