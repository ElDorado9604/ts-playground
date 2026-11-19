The app.js was accidentally overwritten during a fix attempt.

Please re-run the multi-file support from commit eabc50e2c8b8e80cba3c9f303aecd71c4ef46ebb or contact the assistant to restore.

Known issues being fixed:
1. Maximum call stack size exceeded when importing across files - module loader parameter order and circular deps
2. Type-check lag - debounce increased to 700ms
