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

  // ---- CodeMirror editor with syntax highlighting ----
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
      Tab: function (cm) {
        if (cm.somethingSelected()) {
          cm.indentSelection("add");
        } else {
          cm.replaceSelection("  ", "end");
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
    cm._checkTimer = setTimeout(checkTypes, 300);
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

  // Keep CodeMirror sized when layout changes
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

  function formatDiag(d, sourceFile) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    const file = d.file || sourceFile;
    if (file && d.start != null) {
      const pos = file.getLineAndCharacterOfPosition(d.start);
      return "Line " + (pos.line + 1) + ":" + (pos.character + 1) + " — " + msg;
    }
    return msg;
  }

  function checkTypes() {
    if (typeof ts === "undefined") {
      diagnosticsEl.textContent = "TypeScript not loaded yet...";
      diagnosticsEl.className = "diagnostics";
      return false;
    }
    const code = getCode();
    const fileName = "input.ts";
    const sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.ES2020,
      true,
      ts.ScriptKind.TS
    );
    const synDiags = sourceFile.parseDiagnostics || [];
    const result = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.None,
        strict: true,
        noEmitOnError: false,
      },
      reportDiagnostics: true,
      fileName: fileName,
    });
    const all = [].concat(synDiags).concat(result.diagnostics || []);
    const seen = Object.create(null);
    const messages = [];
    for (let i = 0; i < all.length; i++) {
      const line = formatDiag(all[i], sourceFile);
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
    if (typeof ts !== "undefined") checkTypes();
    else setTimeout(waitForTs, 100);
  }
  waitForTs();
})();
