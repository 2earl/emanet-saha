import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', '**/.wrangler/', 'node_modules/', 'worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['public/*.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked },
  // The one browser script: plain JavaScript, served as is.
  {
    files: ['public/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { document: 'readonly', navigator: 'readonly' } },
  },
);
