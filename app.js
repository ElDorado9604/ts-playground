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
  const fileTabsEl = document.getElementById("file-tabs");
  const fileCountEl = document.getElementById("file-count");
  const btnNewFile = document.getElementById("btn-new-file");
  const renameBackdrop = document.getElementById("rename-backdrop");
  const renameDialog = document.getElementById("rename-dialog");
  const renameInput = document.getElementById("rename-input");
  const renameError = document.getElementById("rename-error");
  const btnRenameCancel = document.getElementById("btn-rename-cancel");
  const btnRenameConfirm = document.getElementById("btn-rename-confirm");
  const toastEl = document.getElementById("toast");

  let hasRunOnce = false;
  let runId = 0;
  let activeWorker = null;
  let renameTarget = null;

  const RUN_TIMEOUT_MS = 15000;
  const MAX_LOG_LINES = 500;
  const MAX_FILES = 3;
  const ENTRY = "main.ts";

  // ---- Default project files (flat) ----
  const defaultFiles = {
    "main.ts":
      '// Entry file — cannot be renamed or deleted\n' +
      'import { add } from "./utils";\n' +
      'import { format } from "./helpers";\n\n' +
      'const greeting: string = "Hello from TS Playground";\n' +
      "console.log(greeting);\n" +
      'console.log("2 + 3 =", add(2, 3));\n' +
      'console.log(format("Result", 42));\n',
    "utils.ts":
      "export function add(a: number, b: number): number {\n" +
      "  return a + b;\n" +
      "}\n\n" +
      "export function multiply(a: number, b: number): number {\n" +
      "  return a * b;\n" +
      "}\n",
    "helpers.ts":
      "export function format(label: string, value: number): string {\n" +
      "  return `${label}: ${value}`;\n" +
      "}\n\n" +
      "export function capitalize(s: string): string {\n" +
      "  return s.charAt(0).toUpperCase() + s.slice(1);\n" +
      "}\n",
  };

  // fileName → CodeMirror.Doc
  const docs = Object.create(null);
  // ordered list of file names (main.ts always first)
  let fileOrder = ["main.ts", "utils.ts", "helpers.ts"];
  let activeFile = "main.ts";

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

  // Initialize docs
  fileOrder.forEach(function (name) {
    docs[name] = CodeMirror.Doc(defaultFiles[name], "text/typescript");
  });
  cm.swapDoc(docs[activeFile]);

  function getCode(fileName) {
    const name = fileName || activeFile;
    if (docs[name]) return docs[name].getValue();
    return "";
  }

  function getAllFiles() {
    const out = Object.create(null);
    fileOrder.forEach(function (name) {
      out[name] = getCode(name);
    });
    return out;
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

  // ---- File UI ----
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastEl.classList.add("visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toastEl.classList.remove("visible");
      setTimeout(function () {
        toastEl.hidden = true;
      }, 220);
    }, 2800);
  }

  function updateFileCount() {
    const n = fileOrder.length;
    fileCountEl.textContent = n + " / " + MAX_FILES + " files";
    btnNewFile.disabled = n >= MAX_FILES;
  }

  function renderTabs() {
    fileTabsEl.innerHTML = "";
    fileOrder.forEach(function (name) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "file-tab" + (name === activeFile ? " active" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", name === activeFile ? "true" : "false");
      tab.dataset.file = name;

      const nameSpan = document.createElement("span");
      nameSpan.className = "tab-name";
      nameSpan.textContent = name;
      tab.appendChild(nameSpan);

      if (name !== ENTRY) {
        const actions = document.createElement("span");
        actions.className = "tab-actions";

        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "tab-btn";
        renameBtn.title = "Rename";
        renameBtn.setAttribute("aria-label", "Rename " + name);
        renameBtn.textContent = "✎";
        renameBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          openRenameDialog(name);
        });

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "tab-btn delete";
        delBtn.title = "Delete";
        delBtn.setAttribute("aria-label", "Delete " + name);
        delBtn.textContent = "×";
        delBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          deleteFile(name);
        });

        actions.appendChild(renameBtn);
        actions.appendChild(delBtn);
        tab.appendChild(actions);
      }

      tab.addEventListener("click", function () {
        switchFile(name);
      });

      fileTabsEl.appendChild(tab);
    });
    updateFileCount();
  }

  function switchFile(name) {
    if (!docs[name] || name === activeFile) {
      cm.focus();
      return;
    }
    // Current doc already holds the content; just swap
    activeFile = name;
    cm.swapDoc(docs[name]);
    updateUndoRedoButtons();
    renderTabs();
    cm.focus();
    checkTypes();
  }

  function createFile() {
    if (fileOrder.length >= MAX_FILES) {
      showToast("Maximum of 3 files allowed.");
      return;
    }
    let base = "file";
    let i = 1;
    let candidate = base + i + ".ts";
    while (docs[candidate]) {
      i++;
      candidate = base + i + ".ts";
    }
    const content =
      "// " + candidate + "\n" + "export function hello(): string {\n" + '  return "hello";\n' + "}\n";
    docs[candidate] = CodeMirror.Doc(content, "text/typescript");
    fileOrder.push(candidate);
    switchFile(candidate);
  }

  function deleteFile(name) {
    if (name === ENTRY || !docs[name]) return;
    if (fileOrder.length <= 1) return;

    delete docs[name];
    fileOrder = fileOrder.filter(function (f) {
      return f !== name;
    });

    if (activeFile === name) {
      activeFile = ENTRY;
      cm.swapDoc(docs[ENTRY]);
    }
    renderTabs();
    updateUndoRedoButtons();
    checkTypes();
    cm.focus();
  }

  function openRenameDialog(name) {
    if (name === ENTRY) return;
    renameTarget = name;
    renameInput.value = name.replace(/\.ts$/i, "");
    renameError.hidden = true;
    renameError.textContent = "";
    renameBackdrop.classList.add("visible");
    renameDialog.classList.add("open");
    renameBackdrop.setAttribute("aria-hidden", "false");
    renameDialog.setAttribute("aria-hidden", "false");
    setTimeout(function () {
      renameInput.focus();
      renameInput.select();
    }, 50);
  }

  function closeRenameDialog() {
    renameTarget = null;
    renameBackdrop.classList.remove("visible");
    renameDialog.classList.remove("open");
    renameBackdrop.setAttribute("aria-hidden", "true");
    renameDialog.setAttribute("aria-hidden", "true");
  }

  function validateFileName(raw) {
    let name = String(raw || "").trim();
    if (!name) return { ok: false, error: "Name cannot be empty." };
    name = name.replace(/\.ts$/i, "");
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return {
        ok: false,
        error: "Only letters, numbers, underscores, and hyphens allowed.",
      };
    }
    if (name.length > 32) return { ok: false, error: "Name is too long." };
    const full = name + ".ts";
    if (full === ENTRY) return { ok: false, error: "Cannot use the reserved name main.ts." };
    if (docs[full] && full !== renameTarget) {
      return { ok: false, error: "A file with that name already exists." };
    }
    return { ok: true, name: full };
  }

  function confirmRename() {
    if (!renameTarget) return;
    const result = validateFileName(renameInput.value);
    if (!result.ok) {
      renameError.textContent = result.error;
      renameError.hidden = false;
      return;
    }
    const newName = result.name;
    if (newName === renameTarget) {
      closeRenameDialog();
      return;
    }

    // Move doc
    docs[newName] = docs[renameTarget];
    delete docs[renameTarget];

    const idx = fileOrder.indexOf(renameTarget);
    if (idx >= 0) fileOrder[idx] = newName;

    if (activeFile === renameTarget) activeFile = newName;

    closeRenameDialog();
    renderTabs();
    checkTypes();
    cm.focus();
  }

  btnNewFile.addEventListener("click", createFile);
  btnRenameCancel.addEventListener("click", closeRenameDialog);
  btnRenameConfirm.addEventListener("click", confirmRename);
  renameBackdrop.addEventListener("click", closeRenameDialog);

  renameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmRename();
    } else if (e.key === "Escape") {
      closeRenameDialog();
    }
  });

  // ---- Output panel ----
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
    if (e.key === "Escape") {
      if (renameDialog.classList.contains("open")) {
        closeRenameDialog();
      } else if (outputPanel.classList.contains("open")) {
        closeOutput();
      }
    }
  });

  // ---- Type libs ----
  const TS_VERSION = "5.6.3";
  const LIB_CDN =
    "https://cdn.jsdelivr.net/npm/typescript@" + TS_VERSION + "/lib/";

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

  const LIB_ALIASES = {
    ES5: "lib.es5.d.ts",
    es5: "lib.es5.d.ts",
    ES2015: "lib.es2015.d.ts",
    es2015: "lib.es2015.d.ts",
    ES2016: "lib.es2016.d.ts",
    es2016: "lib.es2016.d.ts",
    ES2017: "lib.es2017.d.ts",
    es2017: "lib.es2017.d.ts",
    ES2018: "lib.es2018.d.ts",
    es2018: "lib.es2018.d.ts",
    ES2019: "lib.es2019.d.ts",
    es2019: "lib.es2019.d.ts",
    ES2020: "lib.es2020.d.ts",
    es2020: "lib.es2020.d.ts",
    DOM: "lib.dom.d.ts",
    dom: "lib.dom.d.ts",
    "DOM.Iterable": "lib.dom.iterable.d.ts",
    "dom.iterable": "lib.dom.iterable.d.ts",
  };

  const fsMap = Object.create(null);
  let libsReady = false;
  let libsLoading = null;

  function resolveLibFile(name) {
    let n = String(name).replace(/\\/g, "/");
    const slash = n.lastIndexOf("/");
    if (slash >= 0) n = n.slice(slash + 1);
    if (n.indexOf("./") === 0) n = n.slice(2);
    if (Object.prototype.hasOwnProperty.call(fsMap, n)) return n;
    if (Object.prototype.hasOwnProperty.call(LIB_ALIASES, n)) return LIB_ALIASES[n];
    if (fsMap[n + ".d.ts"]) return n + ".d.ts";
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
      if (!fsMap["lib.es5.d.ts"]) {
        throw new Error("Failed to load core type library (lib.es5.d.ts)");
      }
      if (!fsMap["lib.dom.d.ts"]) {
        throw new Error("Failed to load DOM types (lib.dom.d.ts)");
      }
      Object.keys(LIB_ALIASES).forEach(function (alias) {
        const target = LIB_ALIASES[alias];
        if (fsMap[target]) fsMap[alias] = fsMap[target];
      });
      libsReady = true;
      libsLoading = null;
    });

    return libsLoading;
  }

  function formatDiag(d) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    let prefix = "";
    if (d.file && d.start != null) {
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      const fname = d.file.fileName || "";
      prefix = fname + ":" + (pos.line + 1) + ":" + (pos.character + 1) + " — ";
    }
    return prefix + msg;
  }

  function checkTypes() {
    if (typeof ts === "undefined") {
      diagnosticsEl.textContent = "TypeScript not loaded yet…";
      diagnosticsEl.className = "diagnostics";
      return Promise.resolve(false);
    }

    return loadLibs()
      .then(function () {
        const files = getAllFiles();
        const fileNames = Object.keys(files);

        const compilerOptions = {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.NodeJs,
          lib: ["ES2020", "DOM"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          allowNonTsExtensions: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        };

        const sourceCache = Object.create(null);

        function getSourceFile(name) {
          if (sourceCache[name]) return sourceCache[name];

          // Project files (flat)
          if (Object.prototype.hasOwnProperty.call(files, name)) {
            sourceCache[name] = ts.createSourceFile(
              name,
              files[name],
              compilerOptions.target,
              true,
              ts.ScriptKind.TS
            );
            return sourceCache[name];
          }

          // Also accept "./utils" style
          const bare = name.replace(/^\.\//, "");
          if (Object.prototype.hasOwnProperty.call(files, bare)) {
            sourceCache[name] = ts.createSourceFile(
              bare,
              files[bare],
              compilerOptions.target,
              true,
              ts.ScriptKind.TS
            );
            return sourceCache[name];
          }

          const resolved = resolveLibFile(name);
          const text = fsMap[resolved] || fsMap[name];
          if (typeof text === "string") {
            const sfName = resolved.indexOf("lib.") === 0 ? resolved : name;
            sourceCache[name] = ts.createSourceFile(
              sfName,
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
            if (Object.prototype.hasOwnProperty.call(files, f)) return true;
            const bare = f.replace(/^\.\//, "");
            if (Object.prototype.hasOwnProperty.call(files, bare)) return true;
            const resolved = resolveLibFile(f);
            return (
              Object.prototype.hasOwnProperty.call(fsMap, resolved) ||
              Object.prototype.hasOwnProperty.call(fsMap, f)
            );
          },
          readFile: function (f) {
            if (Object.prototype.hasOwnProperty.call(files, f)) return files[f];
            const bare = f.replace(/^\.\//, "");
            if (Object.prototype.hasOwnProperty.call(files, bare)) return files[bare];
            const resolved = resolveLibFile(f);
            return fsMap[resolved] || fsMap[f];
          },
          directoryExists: function () {
            return true;
          },
          getDirectories: function () {
            return [];
          },
          resolveModuleNames: function (moduleNames, containingFile) {
            return moduleNames.map(function (mod) {
              // Flat project: "./utils" or "utils" → "utils.ts"
              let candidate = mod;
              if (candidate.indexOf("./") === 0) candidate = candidate.slice(2);
              if (candidate.indexOf(".ts") === -1) candidate = candidate + ".ts";
              if (Object.prototype.hasOwnProperty.call(files, candidate)) {
                return { resolvedFileName: candidate, isExternalLibraryImport: false };
              }
              return undefined;
            });
          },
        };

        const program = ts.createProgram(fileNames, compilerOptions, host);

        const diags = []
          .concat(program.getSyntacticDiagnostics())
          .concat(program.getSemanticDiagnostics())
          .concat(ts.getPreEmitDiagnostics(program));

        const userDiags = diags.filter(function (d) {
          if (!d.file) {
            const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
            if (/File '.*' not found/.test(msg)) return false;
            if (/Cannot find global type/.test(msg)) return false;
            return true;
          }
          const fname = d.file.fileName || "";
          return Object.prototype.hasOwnProperty.call(files, fname);
        });

        const seen = Object.create(null);
        const messages = [];
        for (let i = 0; i < userDiags.length; i++) {
          const line = formatDiag(userDiags[i]);
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
          "Type-check setup error: " +
          (err && err.message ? err.message : String(err));
        diagnosticsEl.className = "diagnostics";
        return false;
      });
  }

  function formatRuntimeError(err) {
    if (err == null) return "Unknown error";
    if (typeof err === "string") return err;
    const name = err.name || "Error";
    const message = err.message || String(err);
    return name + ": " + message;
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

  function stopWorker() {
    if (activeWorker) {
      try {
        activeWorker.terminate();
      } catch (e) {}
      activeWorker = null;
    }
  }

  function needsDomDialogs(src) {
    return /\b(prompt|alert|confirm)\s*\(/.test(src);
  }

  // ---- Compile all files to CommonJS-like JS ----
  function compileProject() {
    const files = getAllFiles();
    const compiled = Object.create(null);
    const allDiags = [];

    Object.keys(files).forEach(function (name) {
      const result = ts.transpileModule(files[name], {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
          strict: true,
          esModuleInterop: true,
        },
        reportDiagnostics: true,
        fileName: name,
      });
      compiled[name] = result.outputText;
      if (result.diagnostics && result.diagnostics.length) {
        result.diagnostics.forEach(function (d) {
          allDiags.push(name + ": " + ts.flattenDiagnosticMessageText(d.messageText, "\n"));
        });
      }
    });

    return { compiled: compiled, diagnostics: allDiags };
  }

  // ---- Run ----
  function run() {
    const myRun = ++runId;
    stopWorker();

    try {
      if (typeof ts === "undefined") {
        outputEl.textContent = "Error: TypeScript library failed to load.";
        openOutput();
        return;
      }

      const { compiled, diagnostics } = compileProject();
      let prefix = "";
      if (diagnostics.length) {
        prefix = "Compile errors:\n" + diagnostics.join("\n") + "\n\n";
      }

      // Check if any file uses prompt/alert/confirm
      const allSrc = Object.keys(compiled)
        .map(function (k) {
          return compiled[k];
        })
        .join("\n");
      const filesSrc = getAllFiles();
      const rawSrc = Object.keys(filesSrc)
        .map(function (k) {
          return filesSrc[k];
        })
        .join("\n");

      if (needsDomDialogs(rawSrc) || needsDomDialogs(allSrc)) {
        runOnMainThread(myRun, compiled, prefix);
        return;
      }

      runInWorker(myRun, compiled, prefix);
    } catch (err) {
      outputEl.textContent = "Runner error:\n" + formatRuntimeError(err);
      openOutput();
    }
  }

  // Shared module loader source (CommonJS-style for flat project)
  function buildModuleLoader(compiled) {
    // Serialize the compiled map
    const modulesJson = JSON.stringify(compiled);
    return (
      '"use strict";\n' +
      "var __modules = " +
      modulesJson +
      ";\n" +
      "var __cache = Object.create(null);\n" +
      "function __require(id) {\n" +
      "  var name = String(id).replace(/^\\.\\//, '');\n" +
      "  if (name.slice(-3) !== '.ts' && name.slice(-3) !== '.js') name = name + '.ts';\n" +
      "  if (name.slice(-3) === '.js') name = name.slice(0, -3) + '.ts';\n" +
      "  if (__cache[name]) return __cache[name].exports;\n" +
      "  var code = __modules[name];\n" +
      "  if (typeof code !== 'string') throw new Error('Cannot find module \\'' + id + '\\'');\n" +
      "  var module = { exports: {} };\n" +
      "  __cache[name] = module;\n" +
      "  var fn = new Function('require', 'module', 'exports', 'console', code);\n" +
      "  fn(__require, module, module.exports, console);\n" +
      "  return module.exports;\n" +
      "}\n"
    );
  }

  function runOnMainThread(myRun, compiled, prefix) {
    const logs = [];
    let pending = 0;
    let settled = false;
    let done = false;

    function paint() {
      if (myRun !== runId) return;
      if (logs.length) outputEl.textContent = prefix + logs.join("\n");
      else if (done) outputEl.textContent = prefix + "(no console output)";
      else outputEl.textContent = prefix + "(running…)";
    }

    function pushLog(line) {
      logs.push(line);
      paint();
    }

    function finish() {
      if (myRun !== runId || done) return;
      if (!settled || pending > 0) return;
      done = true;
      paint();
      checkTypes();
    }

    const fakeConsole = {
      log: function () {
        pushLog(Array.prototype.map.call(arguments, stringifyArg).join(" "));
      },
      info: function () {
        pushLog(
          "[info] " + Array.prototype.map.call(arguments, stringifyArg).join(" ")
        );
      },
      warn: function () {
        pushLog(
          "[warn] " + Array.prototype.map.call(arguments, stringifyArg).join(" ")
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

    const killId = realSetTimeout(function () {
      if (myRun !== runId || done) return;
      pushLog(
        "[stopped] Possible infinite loop — halted after " +
          RUN_TIMEOUT_MS / 1000 +
          "s"
      );
      pending = 0;
      settled = true;
      finish();
    }, RUN_TIMEOUT_MS);

    try {
      const loader = buildModuleLoader(compiled);
      // Replace console references inside the loader's require by injecting
      const wrapped =
        loader +
        "\n" +
        "return (async function () {\n" +
        "  var require = __require;\n" +
        "  var console = arguments[0];\n" +
        "  // Override the require's console\n" +
        "  var _origRequire = __require;\n" +
        "  __require = function(id) {\n" +
        "    var name = String(id).replace(/^\\.\\//, '');\n" +
        "    if (name.slice(-3) !== '.ts' && name.slice(-3) !== '.js') name = name + '.ts';\n" +
        "    if (name.slice(-3) === '.js') name = name.slice(0, -3) + '.ts';\n" +
        "    if (__cache[name]) return __cache[name].exports;\n" +
        "    var code = __modules[name];\n" +
        "    if (typeof code !== 'string') throw new Error('Cannot find module \\'' + id + '\\'');\n" +
        "    var module = { exports: {} };\n" +
        "    __cache[name] = module;\n" +
        "    var fn = new Function('require', 'module', 'exports', 'console', code);\n" +
        "    fn(__require, module, module.exports, console);\n" +
        "    return module.exports;\n" +
        "  };\n" +
        "  __require('./main.ts');\n" +
        "})();\n";

      const fn = new Function(
        "console",
        "prompt",
        "alert",
        "confirm",
        "setTimeout",
        "clearTimeout",
        wrapped
      );
      const ret = fn(
        fakeConsole,
        function (msg, def) {
          return window.prompt(msg, def);
        },
        function (msg) {
          window.alert(msg);
        },
        function (msg) {
          return window.confirm(msg);
        },
        trackedTimeout,
        realClearTimeout
      );

      Promise.resolve(ret)
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
          clearTimeout(killId);
          finish();
        });
    } catch (err) {
      pushLog("Runtime error:\n" + formatRuntimeError(err));
      settled = true;
      clearTimeout(killId);
      finish();
    }
  }

  function runInWorker(myRun, compiled, prefix) {
    const logs = [];
    let done = false;

    function paint() {
      if (myRun !== runId) return;
      if (logs.length) outputEl.textContent = prefix + logs.join("\n");
      else if (done) outputEl.textContent = prefix + "(no console output)";
      else outputEl.textContent = prefix + "(running…)";
    }

    function finish() {
      if (myRun !== runId || done) return;
      done = true;
      stopWorker();
      paint();
      checkTypes();
    }

    openOutput();
    paint();

    const loader = buildModuleLoader(compiled);

    const workerSrc =
      '"use strict";\n' +
      "var __logs = 0;\n" +
      "var __maxLogs = " +
      MAX_LOG_LINES +
      ";\n" +
      "function __send(type, payload) { try { postMessage({ type: type, payload: payload }); } catch (e) {} }\n" +
      "function __stringify(a) {\n" +
      "  try {\n" +
      "    if (typeof a === 'string') return a;\n" +
      "    if (a === undefined) return 'undefined';\n" +
      "    if (typeof a === 'object') return JSON.stringify(a, null, 2);\n" +
      "    return String(a);\n" +
      "  } catch (e) { return String(a); }\n" +
      "}\n" +
      "var console = {\n" +
      "  log: function() {\n" +
      "    if (++__logs > __maxLogs) { __send('limit', 'Too many log lines (>' + __maxLogs + ')'); throw new Error('__STOP__'); }\n" +
      "    __send('log', Array.prototype.map.call(arguments, __stringify).join(' '));\n" +
      "  },\n" +
      "  info: function() {\n" +
      "    if (++__logs > __maxLogs) { __send('limit', 'Too many log lines (>' + __maxLogs + ')'); throw new Error('__STOP__'); }\n" +
      "    __send('log', '[info] ' + Array.prototype.map.call(arguments, __stringify).join(' '));\n" +
      "  },\n" +
      "  warn: function() {\n" +
      "    if (++__logs > __maxLogs) { __send('limit', 'Too many log lines (>' + __maxLogs + ')'); throw new Error('__STOP__'); }\n" +
      "    __send('log', '[warn] ' + Array.prototype.map.call(arguments, __stringify).join(' '));\n" +
      "  },\n" +
      "  error: function() {\n" +
      "    if (++__logs > __maxLogs) { __send('limit', 'Too many log lines (>' + __maxLogs + ')'); throw new Error('__STOP__'); }\n" +
      "    __send('log', '[error] ' + Array.prototype.map.call(arguments, __stringify).join(' '));\n" +
      "  },\n" +
      "  debug: function() {\n" +
      "    if (++__logs > __maxLogs) { __send('limit', 'Too many log lines (>' + __maxLogs + ')'); throw new Error('__STOP__'); }\n" +
      "    __send('log', '[debug] ' + Array.prototype.map.call(arguments, __stringify).join(' '));\n" +
      "  }\n" +
      "};\n" +
      loader +
      "\nonmessage = function(ev) {\n" +
      "  if (!ev.data || ev.data.type !== 'run') return;\n" +
      "  try {\n" +
      "    var result = (async function() {\n" +
      "      __require('./main.ts');\n" +
      "    })();\n" +
      "    Promise.resolve(result).then(function() {\n" +
      "      __send('done', null);\n" +
      "    }).catch(function(err) {\n" +
      "      if (err && err.message === '__STOP__') { __send('done', null); return; }\n" +
      "      __send('error', (err && err.name ? err.name + ': ' : '') + (err && err.message ? err.message : String(err)));\n" +
      "    });\n" +
      "  } catch (err) {\n" +
      "    if (err && err.message === '__STOP__') { __send('done', null); return; }\n" +
      "    __send('error', (err && err.name ? err.name + ': ' : '') + (err && err.message ? err.message : String(err)));\n" +
      "  }\n" +
      "};\n";

    const blob = new Blob([workerSrc], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    activeWorker = worker;

    const timeoutId = setTimeout(function () {
      if (myRun !== runId || done) return;
      logs.push(
        "[stopped] Possible infinite loop — halted after " +
          RUN_TIMEOUT_MS / 1000 +
          "s"
      );
      finish();
    }, RUN_TIMEOUT_MS);

    worker.onmessage = function (ev) {
      if (myRun !== runId || done) return;
      const msg = ev.data || {};
      if (msg.type === "log") {
        logs.push(msg.payload);
        paint();
      } else if (msg.type === "limit") {
        logs.push("[stopped] " + msg.payload);
        clearTimeout(timeoutId);
        finish();
      } else if (msg.type === "error") {
        logs.push("Runtime error:\n" + msg.payload);
        clearTimeout(timeoutId);
        finish();
      } else if (msg.type === "done") {
        clearTimeout(timeoutId);
        finish();
      }
    };

    worker.onerror = function (err) {
      if (myRun !== runId || done) return;
      logs.push(
        "Runtime error:\n" + (err && err.message ? err.message : "Worker error")
      );
      clearTimeout(timeoutId);
      finish();
    };

    worker.postMessage({ type: "run" });
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  btnRun.addEventListener("click", function (e) {
    e.preventDefault();
    run();
  });

  btnClear.addEventListener("click", function () {
    outputEl.textContent = "";
  });

  // Boot
  renderTabs();
  function waitForTs() {
    if (typeof ts !== "undefined") checkTypes();
    else setTimeout(waitForTs, 100);
  }
  waitForTs();
})();
