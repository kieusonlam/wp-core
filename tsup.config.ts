import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'models/index': 'src/models/index.ts',
    'auth/index': 'src/auth/index.ts',
    'shortcodes/index': 'src/shortcodes/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'node20',
  external: ['sequelize', 'mysql2', 'php-serialize', 'phpass', 'bcryptjs', 'luxon'],
});
