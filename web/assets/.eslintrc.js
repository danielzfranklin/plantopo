module.exports = {
  env: {
    browser: true,
    es2021: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  overrides: [
  ],
  ignorePatterns: ["/vendor", "/node_modules", ".*", "*.config.js"],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['tsconfig.json']
  },
  plugins: [
    'react'
  ],
  rules: {
    quotes: ['warn', 'single'],
    semi: ['warn', 'always'],
    'comma-dangle': ['warn', 'always-multiline'],
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unnecessary-condition': 'warn',
    'prefer-const': 'warn',
    'no-empty': 'warn',
  }
};
