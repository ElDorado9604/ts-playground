(function () {
  "use strict";

  const outputEl = document.getElementById("output");
  const diagnosticsEl = document.getElementById("diagnostics");
  const outputPanel = document.getElementById("output-panel");
  const outputBackdrop = document.getElementById("output-backdrop");
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnRun = document.getElementById("btn-run");
  const btnOutput = document.getElementById("btn-output");
  const btnClear = document.getElementById("btn-clear");
  const btnCloseOutput = document.getElementById("btn-close-output");

  let hasRunOnce = false;
  let runId = 0;

  const defaultCode =
    "// Write TypeScript here\n" +
    "const greeting: string = 'Hello from TS Playground';\n" +
    "console.log(greeting);\n\n" +
    "function add(a: number, b: number): number {\n" +
    "  return a + b;\n" +
    "}\n\n" +
    "console.log('2 + 3 =', add(2, 3));";

  const cm = CodeMirror.fromTextArea(document.getElementById("editor"), {
    mode: "text/typescript",
    theme: "default",
    lineNumbers: true,
    lineWrapping: true,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    extraKeys: {
      "Ctrl-Enter": function () {
        run();
      },
      "Cmd-Enter": function () {
        run();
      },
      "Ctrl-/": "toggleComment",
      "Cmd-/": "toggleComment",
      Tab: function (editor) {
        if (editor.somethingSelected()) {
          editor.indentSelection("add");
        } else {
          editor.replaceSelection("  ", "end");
        }
      },
    },
    viewportMargin: Infinity,
  });

  cm.setValue(defaultCode);

  function getCode() {
    return cm.getValue();
  }

  function updateUndoRedoButtons() {
    const hist = cm.historySize();
    btnUndo.disabled = hist.undo < 1;
    btnRedo.disabled = hist.redo < 1;
  }

  cm.on("change", function () {
    updateUndoRedoButtons();
    clearTimeout(cm._checkTimer);
    cm._checkTimer = setTimeout(function () {
      checkTypes();
    }, 350);
  });

  btnUndo.addEventListener("click", function () {
    cm.undo();
    cm.focus();
    updateUndoRedoButtons();
  });

  btnRedo.addEventListener("click", function () {
    cm.redo();
    cm.focus();
    updateUndoRedoButtons();
  });

  updateUndoRedoButtons();

  function refreshEditor() {
    cm.refresh();
  }
  window.addEventListener("resize", refreshEditor);
  setTimeout(refreshEditor, 50);

  function openOutput() {
    outputBackdrop.classList.add("visible");
    outputPanel.classList.add("open");
    outputBackdrop.setAttribute("aria-hidden", "false");
    outputPanel.setAttribute("aria-hidden", "false");
    btnOutput.disabled = false;
    hasRunOnce = true;
  }

  function closeOutput() {
    outputBackdrop.classList.remove("visible");
    outputPanel.classList.remove("open");
    outputBackdrop.setAttribute("aria-hidden", "true");
    outputPanel.setAttribute("aria-hidden", "true");
  }

  btnCloseOutput.addEventListener("click", closeOutput);
  outputBackdrop.addEventListener("click", closeOutput);
  btnOutput.addEventListener("click", function () {
    if (hasRunOnce) openOutput();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && outputPanel.classList.contains("open")) {
      closeOutput();
    }
  });

  // ---- Type libs (virtual filesystem) ----
  const TS_VERSION = "5.6.3";
  const LIB_CDN =
    "https://cdn.jsdelivr.net/npm/typescript@" + TS_VERSION + "/lib/";

  // Minimal set that covers ES2020 + DOM globals (console, Promise, Array, …)
  const LIB_FILES = [
    "lib.es5.d.ts",
    "lib.es2015.d.ts",
    "lib.es2015.core.d.ts",
    "lib.es2015.collection.d.ts",
    "lib.es2015.iterable.d.ts",
    "lib.es2015.generator.d.ts",
    "lib.es2015.promise.d.ts",
    "lib.es2015.proxy.d.ts",
    "lib.es2015.reflect.d.ts",
    "lib.es2015.symbol.d.ts",
    "lib.es2015.symbol.wellknown.d.ts",
    "lib.es2016.d.ts",
    "lib.es2016.array.include.d.ts",
    "lib.es2017.d.ts",
    "lib.es2017.object.d.ts",
    "lib.es2017.sharedmemory.d.ts",
    "lib.es2017.string.d.ts",
    "lib.es2017.intl.d.ts",
    "lib.es2017.typedarrays.d.ts",
    "lib.es2018.d.ts",
    "lib.es2018.asyncgenerator.d.ts",
    "lib.es2018.asynciterable.d.ts",
    "lib.es2018.intl.d.ts",
    "lib.es2018.promise.d.ts",
    "lib.es2018.regexp.d.ts",
    "lib.es2019.d.ts",
    "lib.es2019.array.d.ts",
    "lib.es2019.object.d.ts",
    "lib.es2019.string.d.ts",
    "lib.es2019.symbol.d.ts",
    "lib.es2020.d.ts",
    "lib.es2020.bigint.d.ts",
    "lib.es2020.date.d.ts",
    "lib.es2020.number.d.ts",
    "lib.es2020.promise.d.ts",
    "lib.es2020.sharedmemory.d.ts",
    "lib.es2020.string.d.ts",
    "lib.es2020.symbol.wellknown.d.ts",
    "lib.es2020.intl.d.ts",
    "lib.dom.d.ts",
    "lib.dom.iterable.d.ts",
  ];

  /** @type {Record<string, string>} */
  const fsMap = Object.create(null);
  let libsReady = false;
  let libsLoading = null;

  function normalizeLibName(name) {
    // TS may request "lib.es5.d.ts", "/lib.es5.d.ts", or full paths
    let n = String(name).replace(/\\/g, "/");
    const idx = n.lastIndexOf("/");
    if (idx >= 0) n = n.slice(idx + 1);
    return n;
  }

  function loadLibs() {
    if (libsReady) return Promise.resolve();
    if (libsLoading) return libsLoading;

    diagnosticsEl.textContent = "Loading type definitions…";
    diagnosticsEl.className = "diagnostics";

    libsLoading = Promise.all(
      LIB_FILES.map(function (name) {
        return fetch(LIB_CDN + name)
          .then(function (r) {
            if (!r.ok) throw new Error(String(r.status));
            return r.text();
          })
          .then(function (text) {
            fsMap[name] = text;
          })
          .catch(function (err) {
            console.warn("lib load failed", name, err);
          });
      })
    ).then(function () {
      // Sanity: es5 must exist (Array, Boolean, Function, …)
      if (!fsMap["lib.es5.d.ts"]) {
        throw new Error("Failed to load core type library (lib.es5.d.ts)");
      }
      libsReady = true;
      libsLoading = null;
    });

    return libsLoading;
  }

  function formatDiag(d) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && d.start != null) {
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      return "Line " + (pos.line + 1) + ":" + (pos.character + 1) + " — " + msg;
    }
    return msg;
  }

  function checkTypes() {
    if (typeof ts === "undefined") {
      diagnosticsEl.textContent = "TypeScript not loaded yet…";
      diagnosticsEl.className = "diagnostics";
      return Promise.resolve(false);
    }

    return loadLibs()
      .then(function () {
        const code = getCode();
        const fileName = "input.ts";

        const compilerOptions = {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          lib: ["ES2020", "DOM"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          allowNonTsExtensions: true,
        };

        // Cache of SourceFile objects for this check
        const sourceCache = Object.create(null);

        function getSourceFile(name) {
          if (sourceCache[name]) return sourceCache[name];

          if (name === fileName) {
            sourceCache[name] = ts.createSourceFile(
              fileName,
              code,
              compilerOptions.target,
              true,
              ts.ScriptKind.TS
            );
            return sourceCache[name];
          }

          const libName = normalizeLibName(name);
          const text = fsMap[libName];
          if (typeof text === "string") {
            sourceCache[name] = ts.createSourceFile(
              libName,
              text,
              compilerOptions.target,
              true,
              ts.ScriptKind.TS
            );
            return sourceCache[name];
          }
          return undefined;
        }

        const host = {
          getSourceFile: getSourceFile,
          writeFile: function () {},
          getDefaultLibFileName: function () {
            return "lib.es2020.d.ts";
          },
          getDefaultLibLocation: function () {
            return "";
          },
          useCaseSensitiveFileNames: function () {
            return true;
          },
          getCanonicalFileName: function (f) {
            return f;
          },
          getCurrentDirectory: function () {
            return "/";
          },
          getNewLine: function () {
            return "\n";
          },
          fileExists: function (f) {
            if (f === fileName) return true;
            const libName = normalizeLibName(f);
            return Object.prototype.hasOwnProperty.call(fsMap, libName);
          },
          readFile: function (f) {
            if (f === fileName) return code;
            const libName = normalizeLibName(f);
            return fsMap[libName];
          },
          directoryExists: function () {
            return true;
          },
          getDirectories: function () {
            return [];
          },
        };

        const program = ts.createProgram([fileName], compilerOptions, host);
        const sourceFile = program.getSourceFile(fileName);

        const diags = []
          .concat(program.getSyntacticDiagnostics(sourceFile))
          .concat(program.getSemanticDiagnostics(sourceFile))
          .concat(program.getDeclarationDiagnostics(sourceFile))
          .concat(ts.getPreEmitDiagnostics(program, sourceFile));

        // Keep only diagnostics tied to the user file (or global with no file)
        const userDiags = diags.filter(function (d) {
          if (!d.file) return true;
          return normalizeLibName(d.file.fileName) === fileName;
        });

        const seen = Object.create(null);
        const messages = [];
        for (let i = 0; i < userDiags.length; i++) {
          const line = formatDiag(userDiags[i]);
          // Drop residual lib-missing noise if any
          if (/Cannot find global type/.test(line)) continue;
          if (/File 'lib\./.test(line)) continue;
          if (!seen[line]) {
            seen[line] = true;
            messages.push(line);
          }
        }

        if (messages.length === 0) {
          diagnosticsEl.textContent = "No errors";
          diagnosticsEl.className = "diagnostics ok";
          return true;
        }

        diagnosticsEl.textContent = messages.join("\n");
        diagnosticsEl.className = "diagnostics";
        return false;
      })
      .catch(function (err) {
        diagnosticsEl.textContent =
          "Type-check setup error: " + (err && err.message ? err.message : String(err));
        diagnosticsEl.className = "diagnostics";
        return false;
      });
  }

  function formatRuntimeError(err) {
    if (err == null) return "Unknown error";
    const name = err.name || "Error";
    const message = err.message || String(err);
    let text = name + ": " + message;
    if (err.stack) {
      const lines = String(err.stack)
        .split("\n")
        .map(function (l) {
          return l.trim();
        })
        .filter(function (l) {
          if (!l) return false;
          if (/app\.js:\d+/.test(l)) return false;
          if (/^run@/.test(l)) return false;
          if (l === name + ": " + message || l === message) return false;
          return true;
        });
      if (lines.length) text += "\n\n" + lines.slice(0, 4).join("\n");
    }
    return text;
  }

  function stringifyArg(a) {
    try {
      if (typeof a === "string") return a;
      if (a === undefined) return "undefined";
      if (typeof a === "object") return JSON.stringify(a, null, 2);
      return String(a);
    } catch (e) {
      return String(a);
    }
  }

  function run() {
    const myRun = ++runId;

    try {
      if (typeof ts === "undefined") {
        outputEl.textContent = "Error: TypeScript library failed to load.";
        openOutput();
        return;
      }

      const code = getCode();
      const result = ts.transpileModule(code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.None,
          strict: true,
        },
        reportDiagnostics: true,
        fileName: "input.ts",
      });

      let prefix = "";
      if (result.diagnostics && result.diagnostics.length) {
        const msgs = result.diagnostics.map(function (d) {
          return ts.flattenDiagnosticMessageText(d.messageText, "\n");
        });
        prefix = "Compile errors:\n" + msgs.join("\n") + "\n\n";
      }

      const logs = [];
      let pending = 0;
      let settled = false;
      let done = false;
      const MAX_WAIT_MS = 20000;

      function paint() {
        if (myRun !== runId) return;
        if (logs.length) {
          outputEl.textContent = prefix + logs.join("\n");
        } else if (done) {
          outputEl.textContent = prefix + "(no console output)";
        } else {
          outputEl.textContent = prefix + "(running…)";
        }
      }

      function pushLog(line) {
        logs.push(line);
        paint();
      }

      const fakeConsole = {
        log: function () {
          pushLog(Array.prototype.map.call(arguments, stringifyArg).join(" "));
        },
        info: function () {
          pushLog(
            "[info] " +
              Array.prototype.map.call(arguments, stringifyArg).join(" ")
          );
        },
        warn: function () {
          pushLog(
            "[warn] " +
              Array.prototype.map.call(arguments, stringifyArg).join(" ")
          );
        },
        error: function () {
          pushLog(
            "[error] " +
              Array.prototype.map.call(arguments, stringifyArg).join(" ")
          );
        },
        debug: function () {
          pushLog(
            "[debug] " +
              Array.prototype.map.call(arguments, stringifyArg).join(" ")
          );
        },
      };

      const realSetTimeout = window.setTimeout.bind(window);
      const realClearTimeout = window.clearTimeout.bind(window);
      const realSetInterval = window.setInterval.bind(window);
      const realClearInterval = window.clearInterval.bind(window);

      function finish() {
        if (myRun !== runId || done) return;
        if (!settled || pending > 0) return;
        done = true;
        paint();
        checkTypes();
      }

      function trackedTimeout(fn, ms) {
        pending++;
        paint();
        return realSetTimeout(function () {
          try {
            if (typeof fn === "function") fn();
          } catch (err) {
            pushLog("Runtime error:\n" + formatRuntimeError(err));
          } finally {
            pending--;
            finish();
          }
        }, ms);
      }

      openOutput();
      paint();

      realSetTimeout(function () {
        if (myRun !== runId || done) return;
        if (pending > 0 || !settled) {
          pushLog("[note] Stopped waiting after " + MAX_WAIT_MS / 1000 + "s");
        }
        pending = 0;
        settled = true;
        finish();
      }, MAX_WAIT_MS);

      let scriptPromise;
      try {
        const wrapped =
          '"use strict";\n' +
          "return (async function () {\n" +
          result.outputText +
          "\n})();";

        const fn = new Function(
          "console",
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          wrapped
        );

        scriptPromise = fn(
          fakeConsole,
          trackedTimeout,
          realClearTimeout,
          function (cb, ms) {
            pending++;
            paint();
            return realSetInterval(function () {
              try {
                if (typeof cb === "function") cb();
              } catch (err) {
                pushLog("Runtime error:\n" + formatRuntimeError(err));
              }
            }, ms);
          },
          function (id) {
            pending = Math.max(0, pending - 1);
            const r = realClearInterval(id);
            finish();
            return r;
          }
        );
      } catch (err) {
        pushLog("Runtime error:\n" + formatRuntimeError(err));
        settled = true;
        finish();
        return;
      }

      Promise.resolve(scriptPromise)
        .catch(function (err) {
          pushLog("Runtime error:\n" + formatRuntimeError(err));
        })
        .then(function () {
          return new Promise(function (resolve) {
            realSetTimeout(resolve, 0);
          });
        })
        .then(function () {
          settled = true;
          finish();
        });
    } catch (err) {
      outputEl.textContent = "Runner error:\n" + formatRuntimeError(err);
      openOutput();
    }
  }

  btnRun.addEventListener("click", function (e) {
    e.preventDefault();
    run();
  });

  btnClear.addEventListener("click", function () {
    outputEl.textContent = "";
  });

  function waitForTs() {
    if (typeof ts !== "undefined") {
      checkTypes();
    } else {
      setTimeout(waitForTs, 100);
    }
  }
  waitForTs();
})();
