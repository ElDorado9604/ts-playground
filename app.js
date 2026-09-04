(function () {
  "use strict";

  const editor = document.getElementById("editor");
  const output = document.getElementById("output");
  const diagnosticsEl = document.getElementById("diagnostics");
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnRun = document.getElementById("btn-run");
  const btnClear = document.getElementById("btn-clear");
  const btnCopy = document.getElementById("btn-copy");
  const btnPaste = document.getElementById("btn-paste");

  // --- History for Undo / Redo ---
  const MAX_HISTORY = 100;
  let history = [];
  let historyIndex = -1;
  let isApplyingHistory = false;

  function pushHistory(value) {
    if (isApplyingHistory) return;
    // Debounce: only push if different from last
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

  // Initial state
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

  // Input handling with debounce for history
  let inputTimer = null;
  editor.addEventListener("input", function () {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(function () {
      pushHistory(editor.value);
      checkTypes();
    }, 300);
  });

  // Keyboard shortcuts
  editor.addEventListener("keydown", function (e) {
    // Tab inserts spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const val = editor.value;
      editor.value = val.substring(0, start) + "  " + val.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      // Trigger input logic
      pushHistory(editor.value);
      return;
    }
    // Ctrl/Cmd + Z / Y / Enter
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

  // --- Type checking ---
  function checkTypes() {
    if (typeof ts === "undefined") {
      diagnosticsEl.textContent = "TypeScript not loaded yet...";
      diagnosticsEl.className = "diagnostics";
      return;
    }
    const code = editor.value;
    const options = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    };

    // Create a virtual source file
    const fileName = "input.ts";
    const sourceFile = ts.createSourceFile(fileName, code, options.target, true);

    // Simple compiler host for diagnostics only
    const host = {
      getSourceFile: function (name) {
        return name === fileName ? sourceFile : undefined;
      },
      writeFile: function () {},
      getDefaultLibFileName: function () {
        return "lib.es2020.d.ts";
      },
      useCaseSensitiveFileNames: function () {
        return false;
      },
      getCanonicalFileName: function (f) {
        return f;
      },
      getCurrentDirectory: function () {
        return "";
      },
      getNewLine: function () {
        return "\n";
      },
      fileExists: function (f) {
        return f === fileName;
      },
      readFile: function () {
        return "";
      },
      directoryExists: function () {
        return true;
      },
      getDirectories: function () {
        return [];
      },
    };

    const program = ts.createProgram([fileName], options, host);
    const diags = []
      .concat(ts.getPreEmitDiagnostics(program))
      .concat(program.getSemanticDiagnostics())
      .concat(program.getSyntacticDiagnostics());

    if (diags.length === 0) {
      diagnosticsEl.textContent = "No errors";
      diagnosticsEl.className = "diagnostics ok";
      return true;
    }

    const messages = diags.map(function (d) {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (d.file && d.start != null) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        return "Line " + (line + 1) + ":" + (character + 1) + " — " + msg;
      }
      return msg;
    });
    diagnosticsEl.textContent = messages.join("\n");
    diagnosticsEl.className = "diagnostics";
    return false;
  }

  // --- Compile & Run ---
  function run() {
    output.textContent = "";
    if (typeof ts === "undefined") {
      output.textContent = "Error: TypeScript library failed to load.";
      return;
    }

    const code = editor.value;
    const transpileOptions = {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.None,
        strict: true,
      },
      reportDiagnostics: true,
    };

    const result = ts.transpileModule(code, transpileOptions);

    // Show compile diagnostics if any
    if (result.diagnostics && result.diagnostics.length) {
      const msgs = result.diagnostics.map(function (d) {
        return ts.flattenDiagnosticMessageText(d.messageText, "\n");
      });
      output.textContent = "Compile errors:\n" + msgs.join("\n") + "\n\n";
    }

    // Capture console
    const logs = [];
    const original = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
    };

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
        original[level || "log"].apply(console, arguments);
      };
    }

    console.log = capture("");
    console.error = capture("error");
    console.warn = capture("warn");
    console.info = capture("info");

    try {
      // Use Function constructor for isolation
      const fn = new Function(result.outputText);
      fn();
      if (logs.length === 0) {
        logs.push("(no console output)");
      }
      output.textContent += logs.join("\n");
    } catch (err) {
      output.textContent += "Runtime error:\n" + (err && err.stack ? err.stack : String(err));
    } finally {
      console.log = original.log;
      console.error = original.error;
      console.warn = original.warn;
      console.info = original.info;
    }

    // Also refresh type diagnostics
    checkTypes();
  }

  btnRun.addEventListener("click", run);
  btnClear.addEventListener("click", function () {
    output.textContent = "";
  });

  // --- Copy / Paste (mobile friendly) ---
  btnCopy.addEventListener("click", async function () {
    const text = editor.value;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback
        editor.select();
        document.execCommand("copy");
        editor.setSelectionRange(0, 0);
      }
      btnCopy.textContent = "Copied!";
      setTimeout(function () {
        btnCopy.textContent = "Copy";
      }, 1200);
    } catch (e) {
      // Last resort: select so user can copy manually
      editor.focus();
      editor.select();
      alert("Could not copy automatically. Code is selected — use system copy.");
    }
  });

  btnPaste.addEventListener("click", async function () {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const val = editor.value;
        editor.value = val.substring(0, start) + text + val.substring(end);
        editor.selectionStart = editor.selectionEnd = start + text.length;
        pushHistory(editor.value);
        checkTypes();
        editor.focus();
      } else {
        // Fallback: focus and let user paste
        editor.focus();
        alert("Clipboard API not available. Focus the editor and use system paste (long-press or Ctrl+V).");
      }
    } catch (e) {
      editor.focus();
      alert("Paste permission denied or unavailable. Focus the editor and paste manually.");
    }
  });

  // Initial type check after TS loads
  function waitForTs() {
    if (typeof ts !== "undefined") {
      checkTypes();
    } else {
      setTimeout(waitForTs, 100);
    }
  }
  waitForTs();

  // Make editor usable on mobile: prevent zoom on focus is handled by viewport meta
  // Ensure touch selection works
  editor.addEventListener("touchstart", function () {}, { passive: true });
})();
