const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  // The browser-side client ships as a static asset under public/, not under
  // src/, because third parties load it with a <script> tag. Its tests live in
  // src/ like every other one, so the default testMatch still finds them.
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@ohif/([^/]+)/src/(.*)$': '<rootDir>/../../platform/$1/src/$2',
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
  },
};
