'use strict';
// Run directly, not with `node --test`: one process, no test-file worker isolation.
// Usage: node --max-old-space-size=64 tests/native-search-regression.run.cjs
require('./native-search-blocking-regression.test.js');
require('./native-search-surface-regression.test.js');
require('./native-search-caret-handoff.test.js');
require('./mysearch-navigation.test.js');
require('./native-search-integration.test.js');
require('./native-search-redirect.test.js');
