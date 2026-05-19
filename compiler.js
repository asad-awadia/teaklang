#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { Lexer, Parser, Interpreter } = require("./interpreter.js");

const ASYNC_BUILTINS = new Set([
  "sleep", "include", "requireFile", "httpGet", "httpPost", "download"
]);

class AsyncAnalyzer {
  constructor() {
    this.userFunctions = new Map();
    this.asyncFunctions = new Set();
  }

  analyzeProgram(ast) {
    for (const node of ast.body) {
      if (node.type === "FunctionDeclaration" && !node.receiver) {
        const calls = new Set();
        this._collectCalls(node.body, calls);
        for (const p of node.parameters) if (p.defaultValue) this._collectCalls(p.defaultValue, calls);
        this.userFunctions.set(node.name, calls);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name, calls] of this.userFunctions) {
        if (this.asyncFunctions.has(name)) continue;
        for (const callee of calls) {
          if (ASYNC_BUILTINS.has(callee) || this.asyncFunctions.has(callee)) {
            this.asyncFunctions.add(name);
            changed = true;
            break;
          }
        }
      }
    }
  }

  _collectCalls(node, calls) {
    if (!node) return;
    switch (node.type) {
      case "CallExpression":
        if (node.callee.type === "Identifier") calls.add(node.callee.name);
        else if (node.callee.type === "MemberAccess") calls.add("__method_call__");
        for (const arg of node.arguments) this._collectCalls(arg, calls);
        this._collectCalls(node.callee, calls);
        break;
      case "BlockStatement":
        for (const s of node.body) this._collectCalls(s, calls);
        break;
      case "ExpressionStatement": this._collectCalls(node.expression, calls); break;
      case "ReturnStatement": this._collectCalls(node.argument, calls); break;
      case "IfStatement":
        this._collectCalls(node.test, calls);
        this._collectCalls(node.consequent, calls);
        this._collectCalls(node.alternate, calls);
        break;
      case "WhileLoop":
        this._collectCalls(node.test, calls);
        this._collectCalls(node.body, calls);
        break;
      case "ForLoop":
        this._collectCalls(node.iterable, calls);
        this._collectCalls(node.body, calls);
        break;
      case "BinaryExpression":
      case "LogicalExpression":
        this._collectCalls(node.left, calls);
        this._collectCalls(node.right, calls);
        break;
      case "UnaryExpression": this._collectCalls(node.argument, calls); break;
      case "VariableDeclaration": this._collectCalls(node.initializer, calls); break;
      case "AssignmentExpression":
      case "CompoundAssignment":
        this._collectCalls(node.left, calls);
        this._collectCalls(node.right, calls);
        break;
      case "ArrayLiteral":
        for (const e of node.elements) this._collectCalls(e, calls);
        break;
      case "ObjectLiteral":
        for (const p of node.properties) this._collectCalls(p.value, calls);
        break;
      case "Lambda":
        for (const p of node.parameters) if (p.defaultValue) this._collectCalls(p.defaultValue, calls);
        if (Array.isArray(node.body)) for (const s of node.body) this._collectCalls(s, calls);
        else this._collectCalls(node.body, calls);
        break;
      case "WhenExpression":
        this._collectCalls(node.subject || node.discriminant, calls);
        for (const c of node.cases) this._collectCalls(c.result || c.body, calls);
        break;
      case "MemberAccess": this._collectCalls(node.object, calls); break;
      case "IndexExpression":
        this._collectCalls(node.object, calls);
        this._collectCalls(node.index, calls);
        break;
    }
  }

  isSyncUserFunction(name) {
    return this.userFunctions.has(name) &&
      !this.asyncFunctions.has(name) &&
      !this.userFunctions.get(name).has("__method_call__");
  }
}

class Compiler {
  constructor(asyncAnalysis = null) {
    this.helpers = new Set();
    this.asyncAnalysis = asyncAnalysis;
    this.syncFunctionDepth = 0;
  }

  compile(node) {
    if (!node) return "";

    switch (node.type) {
      case "Program":
        return node.body.map((s) => this.compile(s)).join(";\n") + ";\n";

      case "VariableDeclaration":
        // In JS we can use let for both var and val safely.
        return `let ${node.identifier} = ${this.compile(node.initializer)}`;

      case "ExpressionStatement":
        return this.compile(node.expression);

      case "BlockStatement":
        return `{\n${node.body.map((s) => this.compile(s)).join(";\n")}\n}`;

      case "ForLoop":
        if (node.iterable.type === "BinaryExpression" && node.iterable.operator === "..") {
          const from = this.compile(node.iterable.left);
          const to = this.compile(node.iterable.right);
          return `for (let ${node.identifier} = ${from}; ${node.identifier} <= ${to}; ${node.identifier}++) ${this.compile(node.body)}`;
        } else {
          this.helpers.add("iterator");
          const awaitKw = this.syncFunctionDepth > 0 ? "" : "await ";
          return `for ${awaitKw}(const ${node.identifier} of __getIterator(${this.compile(node.iterable)})) ${this.compile(node.body)}`;
        }

      case "WhileLoop":
        return `while (${this.compile(node.test)}) { ${this.compile(node.body)} }`;

      case "BreakStatement":
        return "break";

      case "ContinueStatement":
        return "continue";

      case "ReturnStatement":
        return `return ${node.argument ? this.compile(node.argument) : ""}`;

      case "IfStatement":
        let alt = node.alternate ? ` else { ${this.compile(node.alternate)} }` : "";
        return `if (${this.compile(node.test)}) { ${this.compile(node.consequent)} }${alt}`;

      case "DataClassDeclaration":
        const fields = node.fields.map(f => f.defaultValue ? `${f.name} = ${this.compile(f.defaultValue)}` : f.name).join(", ");
        const assigns = node.fields.map(f => `this.${f.name} = ${f.name};`).join("\n    ");
        const toStringFields = node.fields.map(f => `"${f.name}=" + this.${f.name}`).join(", ");
        const fnames = node.fields.map(f => f.name).join(", ");
        return `
class __${node.name} {
  constructor(${fields}) {
    ${assigns}
  }
  toString() { return "${node.name}(" + [${toStringFields}].join(", ") + ")"; }
  toJson() { return JSON.stringify(this); }
}
const ${node.name} = (${fnames}) => new __${node.name}(${fnames});
${node.name}.defineMethod = (n, fn) => { __${node.name}.prototype[n] = fn; };
`;

      case "FunctionDeclaration": {
        let params = node.parameters.map(p => p.defaultValue ? `${p.name} = ${this.compile(p.defaultValue)}` : p.name);
        if (node.receiver) params.unshift(node.receiver.name);

        const fnSync = !node.receiver && this.asyncAnalysis && this.asyncAnalysis.isSyncUserFunction(node.name);
        if (fnSync) this.syncFunctionDepth++;
        let body = node.body.type === "BlockStatement"
          ? this.compile(node.body)
          : `{ return ${this.compile(node.body)}; }`;
        if (fnSync) this.syncFunctionDepth--;

        const asyncKw = fnSync ? "" : "async ";

        if (node.receiver) {
          return `${node.receiver.typeName}.defineMethod("${node.name}", ${asyncKw}function(${params.join(", ")}) ${body})`;
        } else {
          return `${asyncKw}function ${node.name}(${params.join(", ")}) ${body}`;
        }
      }

      case "Lambda": {
        const lparams = node.parameters.length > 0 
          ? node.parameters.map(p => p.defaultValue ? `${p.name} = ${this.compile(p.defaultValue)}` : p.name).join(", ") 
          : "it";
        const prevDepth = this.syncFunctionDepth;
        this.syncFunctionDepth = 0;
        let lbody;
        if (Array.isArray(node.body)) {
          const stmts = node.body.map((s, i) => {
            const isLast = i === node.body.length - 1;
            if (isLast && s.type === "ExpressionStatement") {
              return `return ${this.compile(s.expression)}`;
            }
            return this.compile(s);
          });
          lbody = stmts.join(";\n");
        } else {
          lbody = `return ${this.compile(node.body)}`;
        }
        this.syncFunctionDepth = prevDepth;
        return `async (${lparams}) => {\n${lbody}\n}`;
      }

      case "BinaryExpression":
        if (node.operator === "..") return `new Range(${this.compile(node.left)}, ${this.compile(node.right)})`;
        if (node.operator === "to") return `ArrayList._wrap([${this.compile(node.left)}, ${this.compile(node.right)}])`;
        if (node.operator === "==") return `${this.compile(node.left)} === ${this.compile(node.right)}`;
        if (node.operator === "!=") return `${this.compile(node.left)} !== ${this.compile(node.right)}`;
        return `(${this.compile(node.left)} ${node.operator} ${this.compile(node.right)})`;

      case "LogicalExpression":
        return `${this.compile(node.left)} ${node.operator} ${this.compile(node.right)}`;
      case "CompoundAssignment":
      case "AssignmentExpression": {
        const op = node.operator || "=";
        const right = this.compile(node.right);
        if (node.left.type === "IndexExpression") {
          this.helpers.add("setIndex");
          const obj = this.compile(node.left.object);
          const idx = this.compile(node.left.index);
          if (op !== "=") {
            this.helpers.add("getIndex");
            return `__setIndex(${obj}, ${idx}, __getIndex(${obj}, ${idx}) ${op.replace('=', '')} ${right})`;
          }
          return `__setIndex(${obj}, ${idx}, ${right})`;
        } else if (node.left.type === "MemberAccess") {
          this.helpers.add("setMember");
          const obj = this.compile(node.left.object);
          const prop = `"${node.left.property}"`;
          if (op !== "=") {
            this.helpers.add("getMember");
            return `__setMember(${obj}, ${prop}, __getMember(${obj}, ${prop}) ${op.replace('=', '')} ${right})`;
          }
          return `__setMember(${obj}, ${prop}, ${right})`;
        }
        return `${this.compile(node.left)} ${op} ${right}`;
      }

      case "UnaryExpression":
        return `${node.operator}${this.compile(node.argument)}`;

      case "Literal":
        return JSON.stringify(node.value);

      case "Identifier":
        return node.name;

      case "CallExpression": {
        const args = node.arguments.map((a) => this.compile(a)).join(", ");
        // Inside a sync function body, await is a syntax error — skip it for all calls.
        if (this.syncFunctionDepth > 0) {
          this.helpers.add("wrap");
          if (node.callee.type === "MemberAccess") {
            const obj = this.compile(node.callee.object);
            this.helpers.add("getMember");
            return `__wrap(__getMember(${obj}, "${node.callee.property}")(${args}))`;
          }
          return `__wrap(${this.compile(node.callee)}(${args}))`;
        }
        if (node.callee.type === "MemberAccess") {
          this.helpers.add("callMember");
          this.helpers.add("getMember");
          return `await __callMember(${this.compile(node.callee.object)}, "${node.callee.property}", [${args}])`;
        }
        const calleeName = node.callee.type === "Identifier" ? node.callee.name : null;
        if (calleeName && this.asyncAnalysis && this.asyncAnalysis.isSyncUserFunction(calleeName)) {
          return `${this.compile(node.callee)}(${args})`;
        }
        this.helpers.add("wrap");
        return `__wrap(await ${this.compile(node.callee)}(${args}))`;
      }

      case "MemberAccess":
        this.helpers.add("getMember");
        return `__getMember(${this.compile(node.object)}, "${node.property}")`;

      case "IndexExpression":
        this.helpers.add("getIndex");
        this.helpers.add("wrap");
        return `__wrap(__getIndex(${this.compile(node.object)}, ${this.compile(node.index)}))`;

      case "ArrayLiteral":
        return `ArrayList._wrap([${node.elements.map((e) => this.compile(e)).join(", ")}])`;

      case "ObjectLiteral":
        return `({${node.properties.map((p) => `"${p.key}": ${this.compile(p.value)}`).join(", ")}})`;

      case "WhenExpression": {
        const subject = node.discriminant ? this.compile(node.discriminant) : "true";
        let whenCode = `(() => {\n  const __val = ${subject};\n`;
        for (const c of node.cases) {
          if (c.isElse) {
            whenCode += `  return ${this.compile(c.result)};\n`;
          } else {
            const conds = c.values.map((cond) => `__val === ${this.compile(cond)}`).join(" || ");
            whenCode += `  if (${conds}) return ${this.compile(c.result)};\n`;
          }
        }
        whenCode += `})()`;
        return whenCode;
      }

      default:
        return `/* UNKNOWN NODE: ${node.type} */`;
    }
  }

  generateHelpers() {
    let code = ``;
    if (this.helpers.has("getMember")) {
      code += `
function __getMember(obj, prop) {
    if (obj != null && obj instanceof TkMap) {
        const method = obj[prop];
        if (method !== undefined) return typeof method === "function" ? method.bind(obj) : method;
        return __wrap(obj.get(prop));
    }
    if (Array.isArray(obj) && !(obj instanceof ArrayList)) obj = ArrayList._wrap(obj);
    const p = (obj != null) ? obj[prop] : undefined;
    if (typeof p === "function") return p.bind(obj);
    return __wrap(p);
}
`;
    }
    if (this.helpers.has("callMember")) {
      code += `
function __callMember(obj, prop, args) {
    const member = __getMember(obj, prop);
    if (typeof member === "function") {
        let res = member.apply(obj, args);
        if (res instanceof Promise) {
            return res.then(v => __wrap(v));
        }
        return Promise.resolve(__wrap(res));
    }
    throw new Error(prop + " is not a function");
}
`;
    }
    if (this.helpers.has("getIndex")) {
      code += `
function __getIndex(obj, index) {
    if (obj instanceof ArrayList) return obj._a[index];
    if (obj instanceof TkMap) return obj.get(index);
    return obj[index];
}
`;
    }
    if (this.helpers.has("setIndex")) {
      code += `
function __setIndex(obj, index, value) {
    if (obj instanceof ArrayList) obj._a[index] = value;
    else if (obj instanceof TkMap) obj.put(index, value);
    else obj[index] = value;
    return value;
}
`;
    }
    if (this.helpers.has("setMember")) {
      code += `
function __setMember(obj, prop, value) {
    if (obj instanceof TkMap) obj.put(prop, value);
    else obj[prop] = value;
    return value;
}
`;
    }
    if (this.helpers.has("iterator")) {
      code += `
function __getIterator(obj) {
    if (obj instanceof Range || obj instanceof ArrayList || obj instanceof Sequence || obj instanceof TkSet) return obj;
    if (Array.isArray(obj)) return obj;
    throw new Error("Not iterable: " + obj);
}
`;
    }
    if (this.helpers.has("wrap")) {
      code += `
function __wrap(v) {
    return (Array.isArray(v) && !(v instanceof ArrayList)) ? ArrayList._wrap(v) : v;
}
`;
    }
    return code;
  }
}

function compileFile(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const lexer = new Lexer(src);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();

  const asyncAnalysis = new AsyncAnalyzer();
  asyncAnalysis.analyzeProgram(ast);

  const compiler = new Compiler(asyncAnalysis);
  const compiledBody = compiler.compile(ast);
  const helpers = compiler.generateHelpers();

  // Inject the global environment bindings from the runtime
  const prologue = `
const { Range, ArrayList, TkMap, TkSet, Sequence, createGlobalEnvironment } = require('./runtime.js');
const __env = createGlobalEnvironment();
// Expose all built-in bindings to the global scope for parity with the interpreter
for (const [k, v] of Object.entries(__env.bindings)) {
  global[k] = v;
}

${helpers}

// --- COMPILED KOT-SCRIPT ---
async function __main() {
${compiledBody}
}

__main().catch(console.error);
`;

  return prologue;
}

if (require.main === module) {
  if (process.argv.length < 3) {
    console.error("Usage: node compiler.js <file.tk>");
    process.exit(1);
  }
  const file = process.argv[2];
  const outPath = file.replace(/\.tk$/, ".out.js");
  const js = compileFile(file);
  fs.writeFileSync(outPath, js);
  console.log(`Compiled ${file} -> ${outPath}`);
}

module.exports = { Compiler, compileFile };
