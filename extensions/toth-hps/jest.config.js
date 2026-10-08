const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // Las extensiones viven en extensions/, no en platform/: hpMammo parte del
    // protocolo de @ohif/extension-default.
    '^@ohif/extension-([^/]+)/src/(.*)$': '<rootDir>/../$1/src/$2',
    '^@ohif/([^/]+)/src/(.*)$': '<rootDir>/../../platform/$1/src/$2',
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
  },
};
