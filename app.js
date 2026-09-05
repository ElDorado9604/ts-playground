(function () {
  "use strict";

  const editor = document.getElementById("editor");
  const output = document.getElementById("output");
  const diagnosticsEl = document.getElementById("diagnostics");
  const outputPanel = document.getElementById("output-panel");
  const outputBackdrop = document.getElementById("output-backdrop");
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnRun = document.getElementById("btn-run");
  const btnOutput = document.getElementById("btn-output");
  const btnClear = document.getElementById("btn-clear");
  const btnCloseOutput = document.getElementById("btn-close-output");

  // --- History for Undo / Redo ---
  const MAX_HISTORY = 100;
  let history = [];
  let historyIndex = -1;
  let isApplyingHistory = false;
  let hasRunOnce = false;
  let runId = 0; // cancel stale async finishes

  function pushHistory(value) {
    if (isApplyingHistory) return;
    if (historyIndex >= 0 && history[historyIndex] === value) return;
    history = history.slice(0, historyIndex + 1);
    history.push(value);
    if (history.length > MAX_HISTORY) {
      history.shift();
    } else {
      historyIndex++;
    }
    updateUndoRedoButtons();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    isApplyingHistory = true;
    editor.value = history[historyIndex];
    isApplyingHistory = false;
    updateUndoRedoButtons();
    checkTypes();
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    isApplyingHistory = true;
    editor.value = history[historyIndex];
    isApplyingHistory = false;
    updateUndoRedoButtons();
    checkTypes();
  }

  function updateUndoRedoButtons() {
    btnUndo.disabled = historyIndex <= 0;
    btnRedo.disabled = historyIndex >= history.length - 1;
  }

  const defaultCode =
    "// Write TypeScript here\n" +
    "const greeting: string = 'Hello from TS Playground';\n" +
    "console.log(greeting);\n\n" +
    "function add(a: number, b: number): number {\n" +
    "  return a + b;\n" +
    "}\n\n" +
    "console.log('2 + 3 =', add(2, 3));";

  editor.value = defaultCode;
  pushHistory(defaultCode);

  let inputTimer = null;
  editor.addEventListener("input", function () {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(function () {
      pushHistory(editor.value);
      checkTypes();
    }, 300);
  });

  editor.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const val = editor.value;
      editor.value = val.substring(0, start) + "  " + val.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      pushHistory(editor.value);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if (mod && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  btnUndo.addEventListener("click", undo);
  btnRedo.addEventListener("click", redo);

  // --- Output panel ---
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

  // --- Type / syntax check ---
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

    const code = editor.value;
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

      if (lines.length) {
        text += "\n\n" + lines.slice(0, 4).join("\n");
      }
    }

    return text;
  }

  function isThenable(v) {
    return v != null && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
  }

  // --- Compile & Run (supports async / setTimeout) ---
  function run() {
    const myRun = ++runId;
    output.textContent = "";
    if (typeof ts === "undefined") {
      output.textContent = "Error: TypeScript library failed to load.";
      openOutput();
      return;
    }

    const code = editor.value;
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
    let pendingTimers = 0;
    let finished = false;
    const MAX_WAIT_MS = 15000; // safety cap for long timers

    const original = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      setTimeout: window.setTimeout,
      clearTimeout: window.clearTimeout,
      setInterval: window.setInterval,
      clearInterval: window.clearInterval,
    };

    function refreshOutput() {
      if (myRun !== runId) return;
      const body =
        logs.length > 0
          ? logs.join("\n")
          : finished
            ? "(no console output)"
            : "(running…)";
      output.textContent = prefix + body;
    }

    function capture(level) {
      return function () {
        const args = Array.prototype.slice.call(arguments);
        const str = args
          .map(function (a) {
            try {
              return typeof a === "object" ? JSON.stringify(a, null, 2) : String(a);
            } catch (e) {
              return String(a);
            }
          })
          .join(" ");
        logs.push((level ? "[" + level + "] " : "") + str);
        refreshOutput();
        original[level || "log"].apply(console, arguments);
      };
    }

    function restoreGlobals() {
      console.log = original.log;
      console.error = original.error;
      console.warn = original.warn;
      console.info = original.info;
      window.setTimeout = original.setTimeout;
      window.clearTimeout = original.clearTimeout;
      window.setInterval = original.setInterval;
      window.clearInterval = original.clearInterval;
    }

    function tryFinish() {
      if (myRun !== runId || finished) return;
      if (pendingTimers > 0) return;
      finished = true;
      restoreGlobals();
      refreshOutput();
      checkTypes();
    }

    console.log = capture("");
    console.error = capture("error");
    console.warn = capture("warn");
    console.info = capture("info");

    // Track timers so we keep capturing until async work settles
    window.setTimeout = function (fn, delay) {
      const args = Array.prototype.slice.call(arguments, 2);
      pendingTimers++;
      refreshOutput();
      return original.setTimeout(function () {
        try {
          if (typeof fn === "function") fn.apply(null, args);
        } catch (err) {
          logs.push("Runtime error:\n" + formatRuntimeError(err));
          refreshOutput();
        } finally {
          pendingTimers--;
          tryFinish();
        }
      }, delay);
    };

    window.clearTimeout = function (id) {
      return original.clearTimeout(id);
    };

    window.setInterval = function (fn, delay) {
      // intervals keep pending forever until cleared — count as 1 sticky
      pendingTimers++;
      refreshOutput();
      const id = original.setInterval(function () {
        try {
          if (typeof fn === "function") fn();
        } catch (err) {
          logs.push("Runtime error:\n" + formatRuntimeError(err));
          refreshOutput();
        }
      }, delay);
      return id;
    };

    window.clearInterval = function (id) {
      pendingTimers = Math.max(0, pendingTimers - 1);
      const r = original.clearInterval(id);
      tryFinish();
      return r;
    };

    // Hard timeout so we never hang forever
    original.setTimeout(function () {
      if (myRun !== runId || finished) return;
      if (pendingTimers > 0) {
        logs.push("[note] Still waiting on async work (stopped after " + MAX_WAIT_MS / 1000 + "s)");
      }
      pendingTimers = 0;
      tryFinish();
    }, MAX_WAIT_MS);

    openOutput();
    refreshOutput();

    try {
      // Run as async function body so top-level await works if user uses it
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction(result.outputText);
      const ret = fn();

      // If the script returns a Promise (or top-level await), wait for it
      Promise.resolve(ret)
        .then(function () {
          // Drain microtasks / thenables kicked off without being returned
          // (e.g. main() called but not awaited by the script)
          return new Promise(function (resolve) {
            // two ticks + a short delay covers typical promise chains
            original.setTimeout(function () {
              original.setTimeout(resolve, 0);
            }, 0);
          });
        })
        .then(function () {
          tryFinish();
        })
        .catch(function (err) {
          logs.push("Runtime error:\n" + formatRuntimeError(err));
          refreshOutput();
          tryFinish();
        });
    } catch (err) {
      logs.push("Runtime error:\n" + formatRuntimeError(err));
      refreshOutput();
      tryFinish();
    }
  }

  btnRun.addEventListener("click", run);
  btnClear.addEventListener("click", function () {
    output.textContent = "";
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
