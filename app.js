(function(){"use strict";
var outputEl=document.getElementById("output"),diagnosticsEl=document.getElementById("diagnostics");
var outputPanel=document.getElementById("output-panel"),outputBackdrop=document.getElementById("output-backdrop");
var btnUndo=document.getElementById("btn-undo"),btnRedo=document.getElementById("btn-redo");
var btnRun=document.getElementById("btn-run"),btnOutput=document.getElementById("btn-output");
var btnClear=document.getElementById("btn-clear"),btnCloseOutput=document.getElementById("btn-close-output");
var fileTabsEl=document.getElementById("file-tabs"),fileCountEl=document.getElementById("file-count");
var btnNewFile=document.getElementById("btn-new-file");
var renameBackdrop=document.getElementById("rename-backdrop"),renameDialog=document.getElementById("rename-dialog");
var renameInput=document.getElementById("rename-input"),renameError=document.getElementById("rename-error");
var btnRenameCancel=document.getElementById("btn-rename-cancel"),btnRenameConfirm=document.getElementById("btn-rename-confirm");
var toastEl=document.getElementById("toast");
var hasRunOnce=false,runId=0,activeWorker=null,renameTarget=null;
var RUN_TIMEOUT_MS=15000,MAX_LOG_LINES=500,MAX_FILES=10,ENTRY="main.ts";
var defaultFiles={
"main.ts":'// Entry file\nimport { add } from "./utils";\nimport { Formatter } from "./helpers";\n\nconst greeting: string = "Hello from TS Playground";\nconsole.log(greeting);\nconsole.log("2 + 3 =", add(2, 3));\n\nconst fmt = new Formatter("App");\nconsole.log(fmt.format("Result", 42));\nconsole.log(fmt.capitalize("typescript"));\n',
"utils.ts":"export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n",
"helpers.ts":"export class Formatter {\n  private prefix: string;\n  constructor(prefix: string = \"\") { this.prefix = prefix; }\n  format(label: string, value: number): string {\n    const tag = this.prefix ? `[${this.prefix}] ` : \"\";\n    return `${tag}${label}: ${value}`;\n  }\n  capitalize(s: string): string {\n    if (!s) return s;\n    return s.charAt(0).toUpperCase() + s.slice(1);\n  }\n}\n"
};
var docs=Object.create(null),fileOrder=["main.ts","utils.ts","helpers.ts"],activeFile="main.ts";
var cm=CodeMirror.fromTextArea(document.getElementById("editor"),{
mode:"text/typescript",theme:"default",lineNumbers:true,lineWrapping:true,indentUnit:2,tabSize:2,indentWithTabs:false,
matchBrackets:true,autoCloseBrackets:true,viewportMargin:Infinity,
extraKeys:{"Ctrl-Enter":function(){run()},"Cmd-Enter":function(){run()},"Ctrl-/":"toggleComment","Cmd-/":"toggleComment",
Tab:function(ed){if(ed.somethingSelected())ed.indentSelection("add");else ed.replaceSelection("  ","end")}}
});
fileOrder.forEach(function(n){docs[n]=CodeMirror.Doc(defaultFiles[n],"text/typescript")});
cm.swapDoc(docs[activeFile]);
function getCode(n){n=n||activeFile;return docs[n]?docs[n].getValue():""}
function getAllFiles(){var o=Object.create(null);fileOrder.forEach(function(n){o[n]=getCode(n)});return o}
function updateUndoRedoButtons(){var h=cm.historySize();btnUndo.disabled=h.undo<1;btnRedo.disabled=h.redo<1}
cm.on("change",function(){updateUndoRedoButtons();clearTimeout(cm._checkTimer);cm._checkTimer=setTimeout(function(){checkTypes()},700)});
btnUndo.addEventListener("click",function(){cm.undo();cm.focus();updateUndoRedoButtons()});
btnRedo.addEventListener("click",function(){cm.redo();cm.focus();updateUndoRedoButtons()});
updateUndoRedoButtons();
window.addEventListener("resize",function(){cm.refresh()});setTimeout(function(){cm.refresh()},50);
function showToast(m){toastEl.textContent=m;toastEl.hidden=false;toastEl.classList.add("visible");clearTimeout(showToast._t);showToast._t=setTimeout(function(){toastEl.classList.remove("visible");setTimeout(function(){toastEl.hidden=true},220)},2800)}
function updateFileCount(){var n=fileOrder.length;fileCountEl.textContent=n+" / "+MAX_FILES+" files";btnNewFile.disabled=n>=MAX_FILES}
function renderTabs(){fileTabsEl.innerHTML="";fileOrder.forEach(function(name){
var tab=document.createElement("button");tab.type="button";tab.className="file-tab"+(name===activeFile?" active":"");
tab.setAttribute("role","tab");tab.dataset.file=name;
var ns=document.createElement("span");ns.className="tab-name";ns.textContent=name;tab.appendChild(ns);
if(name!==ENTRY){var act=document.createElement("span");act.className="tab-actions";
var rb=document.createElement("button");rb.type="button";rb.className="tab-btn";rb.textContent="\u270e";
rb.addEventListener("click",function(e){e.stopPropagation();openRenameDialog(name)});
var db=document.createElement("button");db.type="button";db.className="tab-btn delete";db.textContent="\u00d7";
db.addEventListener("click",function(e){e.stopPropagation();deleteFile(name)});
act.appendChild(rb);act.appendChild(db);tab.appendChild(act)}
tab.addEventListener("click",function(){switchFile(name)});fileTabsEl.appendChild(tab)});updateFileCount()}
function switchFile(name){if(!docs[name]||name===activeFile){cm.focus();return}activeFile=name;cm.swapDoc(docs[name]);updateUndoRedoButtons();renderTabs();cm.focus();checkTypes()}
function createFile(){if(fileOrder.length>=MAX_FILES){showToast("Maximum of 10 files allowed.");return}
var i=1,c="file"+i+".ts";while(docs[c]){i++;c="file"+i+".ts"}
docs[c]=CodeMirror.Doc("// "+c+"\nexport function hello(): string {\n  return \"hello\";\n}\n","text/typescript");
fileOrder.push(c);switchFile(c)}
function deleteFile(name){if(name===ENTRY||!docs[name]||fileOrder.length<=1)return;delete docs[name];
fileOrder=fileOrder.filter(function(f){return f!==name});if(activeFile===name){activeFile=ENTRY;cm.swapDoc(docs[ENTRY])}
renderTabs();updateUndoRedoButtons();checkTypes();cm.focus()}
function openRenameDialog(name){if(name===ENTRY)return;renameTarget=name;renameInput.value=name.replace(/\.ts$/i,"");
renameError.hidden=true;renameBackdrop.classList.add("visible");renameDialog.classList.add("open");
setTimeout(function(){renameInput.focus();renameInput.select()},50)}
function closeRenameDialog(){renameTarget=null;renameBackdrop.classList.remove("visible");renameDialog.classList.remove("open")}
function validateFileName(raw){var name=String(raw||"").trim().replace(/\.ts$/i,"");
if(!name)return{ok:false,error:"Name cannot be empty."};if(!/^[a-zA-Z0-9_-]+$/.test(name))return{ok:false,error:"Only letters, numbers, underscores, and hyphens allowed."};
if(name.length>32)return{ok:false,error:"Name is too long."};var full=name+".ts";
if(full===ENTRY)return{ok:false,error:"Cannot use the reserved name main.ts."};
if(docs[full]&&full!==renameTarget)return{ok:false,error:"A file with that name already exists."};return{ok:true,name:full}}
function confirmRename(){if(!renameTarget)return;var r=validateFileName(renameInput.value);
if(!r.ok){renameError.textContent=r.error;renameError.hidden=false;return}if(r.name===renameTarget){closeRenameDialog();return}
docs[r.name]=docs[renameTarget];delete docs[renameTarget];var idx=fileOrder.indexOf(renameTarget);
if(idx>=0)fileOrder[idx]=r.name;if(activeFile===renameTarget)activeFile=r.name;closeRenameDialog();renderTabs();checkTypes();cm.focus()}
btnNewFile.addEventListener("click",createFile);btnRenameCancel.addEventListener("click",closeRenameDialog);
btnRenameConfirm.addEventListener("click",confirmRename);renameBackdrop.addEventListener("click",closeRenameDialog);
renameInput.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();confirmRename()}else if(e.key==="Escape")closeRenameDialog()});
function openOutput(){outputBackdrop.classList.add("visible");outputPanel.classList.add("open");btnOutput.disabled=false;hasRunOnce=true}
function closeOutput(){outputBackdrop.classList.remove("visible");outputPanel.classList.remove("open")}
btnCloseOutput.addEventListener("click",closeOutput);outputBackdrop.addEventListener("click",closeOutput);
btnOutput.addEventListener("click",function(){if(hasRunOnce)openOutput()});
document.addEventListener("keydown",function(e){if(e.key==="Escape"){if(renameDialog.classList.contains("open"))closeRenameDialog();else if(outputPanel.classList.contains("open"))closeOutput()}});
var TS_VERSION="5.6.3",LIB_CDN="https://cdn.jsdelivr.net/npm/typescript@"+TS_VERSION+"/lib/";
var LIB_FILES=["lib.es5.d.ts","lib.es2015.d.ts","lib.es2015.core.d.ts","lib.es2015.collection.d.ts","lib.es2015.iterable.d.ts","lib.es2015.promise.d.ts","lib.es2015.symbol.d.ts","lib.es2016.d.ts","lib.es2017.d.ts","lib.es2018.d.ts","lib.es2019.d.ts","lib.es2020.d.ts","lib.es2020.promise.d.ts","lib.dom.d.ts","lib.dom.iterable.d.ts"];
var LIB_ALIASES={ES5:"lib.es5.d.ts",es5:"lib.es5.d.ts",ES2015:"lib.es2015.d.ts",es2015:"lib.es2015.d.ts",ES2020:"lib.es2020.d.ts",es2020:"lib.es2020.d.ts",DOM:"lib.dom.d.ts",dom:"lib.dom.d.ts","DOM.Iterable":"lib.dom.iterable.d.ts","dom.iterable":"lib.dom.iterable.d.ts"};
var fsMap=Object.create(null),libsReady=false,libsLoading=null;
function resolveLibFile(name){var n=String(name).replace(/\\/g,"/");var s=n.lastIndexOf("/");if(s>=0)n=n.slice(s+1);if(n.indexOf("./")===0)n=n.slice(2);if(fsMap[n])return n;if(LIB_ALIASES[n])return LIB_ALIASES[n];if(fsMap[n+".d.ts"])return n+".d.ts";return n}
function loadLibs(){if(libsReady)return Promise.resolve();if(libsLoading)return libsLoading;
diagnosticsEl.textContent="Loading type definitions…";diagnosticsEl.className="diagnostics";
libsLoading=Promise.all(LIB_FILES.map(function(name){return fetch(LIB_CDN+name).then(function(r){if(!r.ok)throw new Error(String(r.status));return r.text()}).then(function(t){fsMap[name]=t}).catch(function(){})})).then(function(){
if(!fsMap["lib.es5.d.ts"])throw new Error("Failed to load core types");Object.keys(LIB_ALIASES).forEach(function(a){if(fsMap[LIB_ALIASES[a]])fsMap[a]=fsMap[LIB_ALIASES[a]]});libsReady=true;libsLoading=null});return libsLoading}
function formatDiag(d){var msg=ts.flattenDiagnosticMessageText(d.messageText,"\n");if(d.file&&d.start!=null){var pos=d.file.getLineAndCharacterOfPosition(d.start);return(d.file.fileName||"")+":"+(pos.line+1)+":"+(pos.character+1)+" — "+msg}return msg}
function checkTypes(){if(typeof ts==="undefined"){diagnosticsEl.textContent="TypeScript not loaded yet…";diagnosticsEl.className="diagnostics";return Promise.resolve(false)}
return loadLibs().then(function(){var files=getAllFiles(),fileNames=Object.keys(files);
var opts={target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.NodeJs,lib:["ES2020","DOM"],strict:true,noEmit:true,skipLibCheck:true,allowNonTsExtensions:true,esModuleInterop:true};
var sourceCache=Object.create(null);
function getSourceFile(name){if(sourceCache[name])return sourceCache[name];if(files[name]!=null)return sourceCache[name]=ts.createSourceFile(name,files[name],opts.target,true,ts.ScriptKind.TS);
var bare=name.replace(/^\.\//,"");if(files[bare]!=null)return sourceCache[name]=ts.createSourceFile(bare,files[bare],opts.target,true,ts.ScriptKind.TS);
var resolved=resolveLibFile(name),text=fsMap[resolved]||fsMap[name];if(typeof text==="string")return sourceCache[name]=ts.createSourceFile(resolved.indexOf("lib.")===0?resolved:name,text,opts.target,true,ts.ScriptKind.TS);return undefined}
var host={getSourceFile:getSourceFile,writeFile:function(){},getDefaultLibFileName:function(){return"lib.es2020.d.ts"},getDefaultLibLocation:function(){return""},useCaseSensitiveFileNames:function(){return true},getCanonicalFileName:function(f){return f},getCurrentDirectory:function(){return"/"},getNewLine:function(){return"\n"},
fileExists:function(f){if(files[f]!=null||files[f.replace(/^\.\//,"")]!=null)return true;var r=resolveLibFile(f);return!!(fsMap[r]||fsMap[f])},
readFile:function(f){if(files[f]!=null)return files[f];var bare=f.replace(/^\.\//,"");if(files[bare]!=null)return files[bare];return fsMap[resolveLibFile(f)]||fsMap[f]},
directoryExists:function(){return true},getDirectories:function(){return[]},
resolveModuleNames:function(ms){return ms.map(function(mod){var c=mod;if(c.indexOf("./")===0)c=c.slice(2);if(c.indexOf(".ts")===-1)c=c+".ts";if(files[c]!=null)return{resolvedFileName:c,isExternalLibraryImport:false};return undefined})}};
var program=ts.createProgram(fileNames,opts,host);
var diags=[].concat(program.getSyntacticDiagnostics(),program.getSemanticDiagnostics(),ts.getPreEmitDiagnostics(program));
var userDiags=diags.filter(function(d){if(!d.file){var msg=ts.flattenDiagnosticMessageText(d.messageText,"\n");if(/File '.*' not found/.test(msg)||/Cannot find global type/.test(msg))return false;return true}return files[d.file.fileName]!=null});
var seen=Object.create(null),messages=[];userDiags.forEach(function(d){var line=formatDiag(d);if(!seen[line]){seen[line]=true;messages.push(line)}});
if(!messages.length){diagnosticsEl.textContent="No errors";diagnosticsEl.className="diagnostics ok";return true}
diagnosticsEl.textContent=messages.join("\n");diagnosticsEl.className="diagnostics";return false}).catch(function(err){diagnosticsEl.textContent="Type-check setup error: "+(err&&err.message?err.message:String(err));diagnosticsEl.className="diagnostics";return false})}
function formatRuntimeError(err){if(err==null)return"Unknown error";if(typeof err==="string")return err;return(err.name||"Error")+": "+(err.message||String(err))}
function stringifyArg(a){try{if(typeof a==="string")return a;if(a===undefined)return"undefined";if(typeof a==="object")return JSON.stringify(a,null,2);return String(a)}catch(e){return String(a)}}
function stopWorker(){if(activeWorker){try{activeWorker.terminate()}catch(e){}activeWorker=null}}
function resolveModuleId(id){var name=String(id||"").replace(/\\/g,"/");if(name.indexOf("./")===0)name=name.slice(2);if(name.charAt(0)==="/")name=name.slice(1);if(name.slice(-3)===".js")name=name.slice(0,-3)+".ts";if(name.slice(-3)!==".ts")name=name+".ts";return name}
function executeModules(compiled,consoleObj){var cache=Object.create(null),loading=Object.create(null),depth=0;
function req(id){var name=resolveModuleId(id);if(cache[name])return cache[name].exports;if(loading[name])return cache[name]?cache[name].exports:{};
var code=compiled[name];if(typeof code!=="string")throw new Error("Cannot find module '"+id+"' (resolved: "+name+")");
if(++depth>50)throw new Error("Maximum require depth exceeded loading '"+name+"'");
var module={exports:{}};cache[name]=module;loading[name]=true;
try{var fn=new Function("exports","require","module","console",code+"\n//# sourceURL="+name);fn(module.exports,req,module,consoleObj)}
finally{delete loading[name];depth--}return module.exports}
return req("./main.ts")}
function compileProject(){var files=getAllFiles(),compiled=Object.create(null),allDiags=[];
Object.keys(files).forEach(function(name){var result=ts.transpileModule(files[name],{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,strict:true,esModuleInterop:true},reportDiagnostics:true,fileName:name});
compiled[name]=result.outputText;if(result.diagnostics&&result.diagnostics.length){result.diagnostics.forEach(function(d){allDiags.push(name+": "+ts.flattenDiagnosticMessageText(d.messageText,"\n"))})}});
return{compiled:compiled,diagnostics:allDiags}}
function run(){var myRun=++runId;stopWorker();
try{if(typeof ts==="undefined"){outputEl.textContent="Error: TypeScript library failed to load.";openOutput();return}
var result=compileProject();var prefix=result.diagnostics.length?"Compile errors:\n"+result.diagnostics.join("\n")+"\n\n":"";
runMain(myRun,result.compiled,prefix)}catch(err){outputEl.textContent="Runner error:\n"+formatRuntimeError(err);openOutput()}}
function runMain(myRun,compiled,prefix){var logs=[],done=false;
function paint(){if(myRun!==runId)return;if(logs.length)outputEl.textContent=prefix+logs.join("\n");else if(done)outputEl.textContent=prefix+"(no console output)";else outputEl.textContent=prefix+"(running…)"}
function finish(){if(myRun!==runId||done)return;done=true;paint();checkTypes()}
var fakeConsole={log:function(){logs.push(Array.prototype.map.call(arguments,stringifyArg).join(" "));paint()},
info:function(){fakeConsole.log.apply(null,["[info]"].concat([].slice.call(arguments)))},
warn:function(){fakeConsole.log.apply(null,["[warn]"].concat([].slice.call(arguments)))},
error:function(){fakeConsole.log.apply(null,["[error]"].concat([].slice.call(arguments)))},
debug:function(){fakeConsole.log.apply(null,["[debug]"].concat([].slice.call(arguments)))}};
openOutput();paint();
var killId=setTimeout(function(){if(myRun!==runId||done)return;logs.push("[stopped] Possible infinite loop — halted after "+RUN_TIMEOUT_MS/1000+"s");finish()},RUN_TIMEOUT_MS);
try{executeModules(compiled,fakeConsole);clearTimeout(killId);Promise.resolve().then(function(){return new Promise(function(r){setTimeout(r,0)})}).then(function(){finish()}).catch(function(err){logs.push("Runtime error:\n"+formatRuntimeError(err));finish()})}
catch(err){logs.push("Runtime error:\n"+formatRuntimeError(err));clearTimeout(killId);finish()}}
btnRun.addEventListener("click",function(e){e.preventDefault();run()});
btnClear.addEventListener("click",function(){outputEl.textContent=""});
renderTabs();
function waitForTs(){if(typeof ts!=="undefined")checkTypes();else setTimeout(waitForTs,100)}
waitForTs();
})();
