module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  extends: ['airbnb-base'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'arrow-parens': 'off',
    'camelcase': 'off',
    'comma-dangle': 'off',
    'comma-spacing': 'off',
    'consistent-return': 'off',
    'default-param-last': 'off',
    'eol-last': 'off',
    'func-names': 'off',
    'import/extensions': 'off',
    'import/order': 'off',
    'import/prefer-default-export': 'off',
    'indent': 'off',
    'linebreak-style': 'off',
    'max-len': 'off',
    'newline-per-chained-call': 'off',
    'no-confusing-arrow': 'off',
    'no-empty': 'off',
    'no-await-in-loop': 'off',
    'no-console': 'off',
    'no-continue': 'off',
    'no-inner-declarations': 'off',
    'no-loop-func': 'off',
    'no-mixed-operators': 'off',
    'no-multiple-empty-lines': 'off',
    'no-nested-ternary': 'off',
    'no-param-reassign': 'off',
    'no-plusplus': 'off',
    'no-promise-executor-return': 'off',
    'no-restricted-syntax': 'off',
    'no-return-await': 'off',
    'no-shadow': 'off',
    'no-underscore-dangle': 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-use-before-define': 'off',
    'no-useless-return': 'off',
    'no-void': 'off',
    'object-curly-newline': 'off',
    'object-shorthand': 'off',
    'operator-linebreak': 'off',
    'prefer-arrow-callback': 'off',
    'prefer-destructuring': 'off',
    'prefer-template': 'off'
  },
  overrides: [
    {
      files: ['test/**/*.js'],
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        vi: 'readonly'
      },
      rules: {
        'import/no-extraneous-dependencies': ['error', { devDependencies: true }]
      }
    }
  ]
};
