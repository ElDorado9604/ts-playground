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
  const btnCopy = document.getElementById("btn-copy");
  const btnPaste = document.getElementById("btn-paste");

  // --- History for Undo / Redo ---
  const MAX_HISTORY = 100;
  let history = [];
  let historyIndex = -1;
  let isApplyingHistory = false;

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

  // --- Output panel show / hide ---
  function openOutput() {
    outputPanel.hidden = false;
    outputBackdrop.hidden = false;
    void outputPanel.offsetWidth;
    outputPanel.classList.add("open");
    btnOutput.hidden = false;
  }

  function closeOutput() {
    outputPanel.classList.remove("open");
    setTimeout(function () {
      if (!outputPanel.classList.contains("open")) {
        outputPanel.hidden = true;
        outputBackdrop.hidden = true;
      }
    }, 230);
  }

  btnCloseOutput.addEventListener("click", closeOutput);
  outputBackdrop.addEventListener("click", closeOutput);
  btnOutput.addEventListener("click", openOutput);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && outputPanel.classList.contains("open")) {
      closeOutput();
    }
  });

  // --- Type / syntax check (browser-friendly, no lib.d.ts needed) ---
  // createProgram needs default libs which are not available from CDN typescript.js alone.
  // transpileModule + createSourceFile give reliable syntax & basic type diagnostics in-browser.
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

    // Syntactic diagnostics from the AST
    const sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.ES2020,
      true,
      ts.ScriptKind.TS
    );

    const synDiags = sourceFile.parseDiagnostics || [];

    // transpileModule reports additional compile diagnostics without needing lib files
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

    const all = []
      .concat(synDiags)
      .concat(result.diagnostics || []);

    // Deduplicate by message text
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

  // --- Compile & Run ---
  function run() {
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

    if (result.diagnostics && result.diagnostics.length) {
      const msgs = result.diagnostics.map(function (d) {
        return ts.flattenDiagnosticMessageText(d.messageText, "\n");
      });
      output.textContent = "Compile errors:\n" + msgs.join("\n") + "\n\n";
    }

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
      const fn = new Function(result.outputText);
      fn();
      if (logs.length === 0) {
        logs.push("(no console output)");
      }
      output.textContent += logs.join("\n");
    } catch (err) {
      output.textContent +=
        "Runtime error:\n" + (err && err.stack ? err.stack : String(err));
    } finally {
      console.log = original.log;
      console.error = original.error;
      console.warn = original.warn;
      console.info = original.info;
    }

    checkTypes();
    openOutput();
  }

  btnRun.addEventListener("click", run);
  btnClear.addEventListener("click", function () {
    output.textContent = "";
  });

  // --- Copy / Paste ---
  btnCopy.addEventListener("click", async function () {
    const text = editor.value;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        editor.select();
        document.execCommand("copy");
        editor.setSelectionRange(0, 0);
      }
      btnCopy.textContent = "Copied!";
      setTimeout(function () {
        btnCopy.textContent = "Copy";
      }, 1200);
    } catch (e) {
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
        editor.focus();
        alert("Clipboard API not available. Focus the editor and use system paste.");
      }
    } catch (e) {
      editor.focus();
      alert("Paste permission denied. Focus the editor and paste manually.");
    }
  });

  function waitForTs() {
    if (typeof ts !== "undefined") {
      checkTypes();
    } else {
      setTimeout(waitForTs, 100);
    }
  }
  waitForTs();

  editor.addEventListener("touchstart", function () {}, { passive: true });
})();
