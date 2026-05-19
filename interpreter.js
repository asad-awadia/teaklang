#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const {
  RuntimeError, Environment,
  TkMap, ImmutableMap, tkStr,
  ArrayList, ImmutableList,
  TkSet, ImmutableSet,
  Sequence, Range, walkDirectory,
  createGlobalEnvironment,
} = require("./runtime.js");

// ─── Errors ───────────────────────────────────────────────────────────────────
class LexError extends SyntaxError {
  constructor(msg, line, col) {
    super(`${msg} at ${line}:${col}`);
    this.name = "LexError";
    this.line = line;
    this.col = col;
  }
}
class ParseError extends SyntaxError {
  constructor(msg, line, col) {
    super(`${msg} at ${line}:${col}`);
    this.name = "ParseError";
    this.line = line;
    this.col = col;
  }
}
class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}
const BREAK = Object.freeze({ type: "break" });
const CONTINUE = Object.freeze({ type: "continue" });

// ─── Static constants ─────────────────────────────────────────────────────────
const KEYWORDS = new Set([
  "val", "var", "fun", "if", "else", "when", "for", "in",
  "while", "true", "false", "null", "return", "break", "continue", "data", "class",
]);
const TWO_CHAR_OPS = new Set(["==", "!=", "<=", ">=", "..", "->", "&&", "||", "+=", "-=", "*=", "/="]);
const PUNCTUATION = new Set("+-*/%=<>!&|.,;:(){}[]".split(""));
const BAIL = Symbol("BAIL"); // sentinel: _eval could not handle this node synchronously

// ─── Lexer ────────────────────────────────────────────────────────────────────
class Lexer {
  constructor(src) {
    this.src = src;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
  }

  _isAlpha(c) {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
  }

  _isDigit(c) {
    return c >= 48 && c <= 57;
  }

  _isAlphaNum(c) {
    return this._isAlpha(c) || this._isDigit(c);
  }

  peek(a = 0) {
    return this.src[this.pos + a] || "";
  }

  adv() {
    const ch = this.src[this.pos++];
    if (ch === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  tokenize() {
    const t = [];
    while (this.pos < this.src.length) {
      const sl = this.line,
        sc = this.col,
        ch = this.peek();

      const chCode = ch.charCodeAt(0);
      if (chCode === 32 || chCode === 9 || chCode === 10 || chCode === 13) {
        this.adv();
        continue;
      }

      if (ch === "/" && this.peek(1) === "/") {
        while (this.peek() !== "\n" && this.pos < this.src.length) this.adv();
        continue;
      }

      if (ch === "/" && this.peek(1) === "*") {
        this.adv();
        this.adv();
        while (
          !(this.peek() === "*" && this.peek(1) === "/") &&
          this.pos < this.src.length
        )
          this.adv();
        this.adv();
        this.adv();
        continue;
      }

      if (this.pos + 1 < this.src.length) {
        const two = this.src[this.pos] + this.src[this.pos + 1];
        if (TWO_CHAR_OPS.has(two)) {
          this.adv();
          this.adv();
          t.push({ type: "operator", value: two, line: sl, column: sc });
          continue;
        }
      }



      if (this._isDigit(chCode)) {
        const start = this.pos;
        while (this.pos < this.src.length && this._isDigit(this.src.charCodeAt(this.pos))) {
          this.pos++;
          this.col++;
        }
        if (this.src[this.pos] === "." && this.pos + 1 < this.src.length && this._isDigit(this.src.charCodeAt(this.pos + 1))) {
          this.pos += 2;
          this.col += 2;
          while (this.pos < this.src.length && this._isDigit(this.src.charCodeAt(this.pos))) {
            this.pos++;
            this.col++;
          }
        }
        const n = this.src.slice(start, this.pos);
        t.push({ type: "number", value: Number(n), line: sl, column: sc });
        continue;
      }

      if (ch === '"' || ch === "'") {
        // triple-quoted raw strings: """..."""
        if (ch === '"' && this.peek(1) === '"' && this.peek(2) === '"') {
          this.adv();
          this.adv();
          this.adv(); // consume """
          let raw = "";
          while (this.pos < this.src.length) {
            if (
              this.peek() === '"' &&
              this.peek(1) === '"' &&
              this.peek(2) === '"'
            ) {
              this.adv();
              this.adv();
              this.adv();
              break;
            }
            raw += this.adv();
          }
          t.push({ type: "string", value: raw, line: sl, column: sc });
          continue;
        }
        const q = this.adv();
        const parts = [];
        let s = "";
        while (this.peek() !== q && this.pos < this.src.length) {
          if (this.peek() === "\\") {
            this.adv();
            const e = this.adv();
            s += { n: "\n", t: "\t", r: "\r" }[e] || e;
          } else if (q === '"' && this.peek() === "$" && this.peek(1) === "{") {
            if (s) {
              parts.push({ type: "text", value: s });
              s = "";
            }
            this.adv();
            this.adv();
            let depth = 1,
              expr = "";
            while (this.pos < this.src.length && depth > 0) {
              const c = this.adv();
              if (c === "{") depth++;
              else if (c === "}") {
                depth--;
                if (depth === 0) break;
              }
              expr += c;
            }
            parts.push({ type: "expr", value: expr });
          } else if (
            q === '"' &&
            this.peek() === "$" &&
            this.pos + 1 < this.src.length && this._isAlpha(this.src.charCodeAt(this.pos + 1))
          ) {
            if (s) {
              parts.push({ type: "text", value: s });
              s = "";
            }
            this.adv(); // consume $
            const start = this.pos;
            while (this.pos < this.src.length && this._isAlphaNum(this.src.charCodeAt(this.pos))) {
              this.pos++;
              this.col++;
            }
            const varName = this.src.slice(start, this.pos);
            parts.push({ type: "expr", value: varName });
          } else {
            s += this.adv();
          }
        }
        if (this.peek() !== q)
          throw new LexError(`Unterminated string`, sl, sc);
        this.adv();
        if (parts.length === 0) {
          t.push({ type: "string", value: s, line: sl, column: sc });
        } else {
          if (s) parts.push({ type: "text", value: s });
          t.push({ type: "template", parts, line: sl, column: sc });
        }
        continue;
      }

      if (this._isAlpha(chCode)) {
        const start = this.pos;
        while (this.pos < this.src.length && this._isAlphaNum(this.src.charCodeAt(this.pos))) {
          this.pos++;
          this.col++;
        }
        const id = this.src.slice(start, this.pos);
        t.push({
          type: KEYWORDS.has(id) ? "keyword" : "identifier",
          value: id,
          line: sl,
          column: sc,
        });
        continue;
      }

      if (PUNCTUATION.has(ch)) {
        this.adv();
        t.push({ type: "punctuation", value: ch, line: sl, column: sc });
        continue;
      }

      throw new LexError(`Unexpected character '${ch}'`, sl, sc);
    }
    t.push({ type: "eof", value: "", line: this.line, column: this.col });
    return t;
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────
class Parser {
  constructor(toks) {
    this.t = toks;
    this.i = 0;
  }
  peek() {
    return this.t[this.i];
  }
  adv() {
    return this.t[this.i++];
  }

  match(ty, v) {
    const k = this.peek();
    if (k && k.type === ty && (v === undefined || k.value === v)) {
      this.i++;
      return true;
    }
    return false;
  }

  expect(ty, v) {
    const k = this.adv();
    if (!k || k.type !== ty || (v !== undefined && k.value !== v)) {
      const got = k ? (k.value !== undefined ? `'${k.value}'` : k.type) : "EOF";
      const exp = v !== undefined ? `'${v}'` : ty;
      throw new ParseError(
        `Syntax error — expected ${exp} but got ${got}`,
        k?.line ?? "?",
        k?.column ?? "?",
      );
    }
    return k;
  }

  _skipTypeAnnotation() {
    if (this.match("punctuation", ":")) {
      while (
        this.peek().type !== "eof" &&
        !(
          this.peek().type === "punctuation" &&
          ["=", ",", ")", "{"].includes(this.peek().value)
        )
      )
        this.adv();
    }
  }

  _tryLambdaParams() {
    const save = this.i;
    const ps = [];
    let foundDefault = false;
    if (this.peek().type === "identifier") {
      while (this.peek().type === "identifier") {
        const paramName = this.adv().value;
        let defaultValue = null;
        if (this.match("punctuation", "=")) {
          defaultValue = this.parseExpression();
          foundDefault = true;
        } else if (foundDefault) {
          this.i = save;
          return null;
        }
        ps.push({ name: paramName, defaultValue });
        if (!this.match("punctuation", ",")) break;
      }
      if (this.match("operator", "->")) return ps;
    }
    this.i = save;
    return null;
  }

  parseProgram() {
    const b = [];
    while (this.peek().type !== "eof") b.push(this.parseStatement());
    return { type: "Program", body: b };
  }

  parseStatement() {
    if (this.match("punctuation", ";")) return { type: "EmptyStatement" };

    if (this.match("keyword", "data")) {
      this.expect("keyword", "class");
      const name = this.expect("identifier").value;
      this.expect("punctuation", "(");
      const fields = [];
      let foundDefault = false;
      if (!this.match("punctuation", ")")) {
        do {
          const fieldName = this.expect("identifier").value;
          this._skipTypeAnnotation();
          let defaultValue = null;
          if (this.match("punctuation", "=")) {
            defaultValue = this.parseExpression();
            foundDefault = true;
          } else if (foundDefault) {
            throw new ParseError("Non-default field cannot follow a default field", this.peek().line, this.peek().column);
          }
          fields.push({ name: fieldName, defaultValue });
        } while (this.match("punctuation", ","));
        this.expect("punctuation", ")");
      }
      return { type: "DataClassDeclaration", name, fields };
    }

    if (this.match("keyword", "val") || this.match("keyword", "var")) {
      const id = this.expect("identifier").value;
      this._skipTypeAnnotation();
      this.expect("punctuation", "=");
      return {
        type: "VariableDeclaration",
        identifier: id,
        initializer: this.parseExpression(),
      };
    }

    if (this.match("keyword", "fun")) {
      let recv = null;
      if (this.match("punctuation", "(")) {
        const rn = this.expect("identifier").value;
        const rt = this.expect("identifier").value;
        this.expect("punctuation", ")");
        recv = { name: rn, typeName: rt };
      }
      const name = this.expect("identifier").value;
      this.expect("punctuation", "(");
      const ps = [];
      let foundDefault = false;
      if (!this.match("punctuation", ")")) {
        do {
          const paramName = this.expect("identifier").value;
          this._skipTypeAnnotation();
          let defaultValue = null;
          if (this.match("punctuation", "=")) {
            defaultValue = this.parseExpression();
            foundDefault = true;
          } else if (foundDefault) {
            throw new ParseError("Non-default parameter cannot follow a default parameter", this.peek().line, this.peek().column);
          }
          ps.push({ name: paramName, defaultValue });
        } while (this.match("punctuation", ","));
        this.expect("punctuation", ")");
      }
      this._skipTypeAnnotation();
      let blk;
      if (this.match("punctuation", "=")) {
        const expr = this.parseExpression();
        blk = {
          type: "BlockStatement",
          body: [{ type: "ReturnStatement", argument: expr }],
        };
      } else {
        const body = this.parseStatement();
        blk =
          body.type === "BlockStatement"
            ? body
            : { type: "BlockStatement", body: [body] };
      }
      return {
        type: "FunctionDeclaration",
        receiver: recv,
        name,
        parameters: ps,
        body: blk,
      };
    }

    if (this.match("keyword", "for")) {
      this.expect("punctuation", "(");
      const id = this.expect("identifier").value;
      this.expect("keyword", "in");
      const it = this.parseExpression();
      this.expect("punctuation", ")");
      return {
        type: "ForLoop",
        identifier: id,
        iterable: it,
        body: this.parseStatement(),
      };
    }

    if (this.match("keyword", "while")) {
      this.expect("punctuation", "(");
      const test = this.parseExpression();
      this.expect("punctuation", ")");
      return { type: "WhileLoop", test, body: this.parseStatement() };
    }

    if (this.match("keyword", "break")) return { type: "BreakStatement" };
    if (this.match("keyword", "continue")) return { type: "ContinueStatement" };

    if (this.match("keyword", "return")) {
      let arg = null;
      const nxt = this.peek();
      const atEnd =
        (nxt.type === "punctuation" && nxt.value === ";") ||
        nxt.type === "eof" ||
        (nxt.type === "punctuation" && nxt.value === "}");
      if (!atEnd) arg = this.parseExpression();
      return { type: "ReturnStatement", argument: arg };
    }

    if (this.match("punctuation", "{")) {
      this.i--;
      return this.parseBlock();
    }

    const e = this.parseExpression();
    this.match("punctuation", ";");
    return { type: "ExpressionStatement", expression: e };
  }

  parseBlock() {
    this.expect("punctuation", "{");
    const s = [];
    while (!this.match("punctuation", "}")) s.push(this.parseStatement());
    return { type: "BlockStatement", body: s };
  }

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const l = this.parseLogicalOr();
    if (this.match("punctuation", "=")) {
      return {
        type: "AssignmentExpression",
        left: l,
        right: this.parseAssignment(),
      };
    }
    for (const op of ["+=", "-=", "*=", "/="]) {
      if (this.match("operator", op)) {
        return {
          type: "CompoundAssignment",
          operator: op,
          left: l,
          right: this.parseAssignment(),
        };
      }
    }
    return l;
  }

  parseLogicalOr() {
    let l = this.parseLogicalAnd();
    while (this.match("operator", "||"))
      l = {
        type: "LogicalExpression",
        operator: "||",
        left: l,
        right: this.parseLogicalAnd(),
      };
    return l;
  }

  parseLogicalAnd() {
    let l = this.parseEquality();
    while (this.match("operator", "&&"))
      l = {
        type: "LogicalExpression",
        operator: "&&",
        left: l,
        right: this.parseEquality(),
      };
    return l;
  }

  parseEquality() {
    let l = this.parseComparison();
    while (this.match("operator", "==") || this.match("operator", "!=")) {
      const op = this.t[this.i - 1].value;
      l = {
        type: "BinaryExpression",
        operator: op,
        left: l,
        right: this.parseComparison(),
      };
    }
    return l;
  }

  parseComparison() {
    let l = this.parseRange();
    while (true) {
      const v = this.peek().value;
      if (v === "<" || v === ">" || v === "<=" || v === ">=") {
        this.adv();
        l = {
          type: "BinaryExpression",
          operator: v,
          left: l,
          right: this.parseRange(),
        };
      } else break;
    }
    return l;
  }

  parseRange() {
    let l = this.parseAddition();
    if (this.match("operator", ".."))
      return {
        type: "BinaryExpression",
        operator: "..",
        left: l,
        right: this.parseAddition(),
      };
    return l;
  }

  parseAddition() {
    let l = this.parseMultiplication();
    while (true) {
      if (this.match("punctuation", "+"))
        l = {
          type: "BinaryExpression",
          operator: "+",
          left: l,
          right: this.parseMultiplication(),
        };
      else if (this.match("punctuation", "-"))
        l = {
          type: "BinaryExpression",
          operator: "-",
          left: l,
          right: this.parseMultiplication(),
        };
      else if (
        this.peek().type === "identifier" &&
        this.peek().value === "to"
      ) {
        this.adv();
        l = {
          type: "BinaryExpression",
          operator: "to",
          left: l,
          right: this.parseMultiplication(),
        };
      } else break;
    }
    return l;
  }

  parseMultiplication() {
    let l = this.parseUnary();
    while (true) {
      const v = this.peek().value;
      if (v === "*" || v === "/" || v === "%") {
        this.adv();
        l = {
          type: "BinaryExpression",
          operator: v,
          left: l,
          right: this.parseUnary(),
        };
      } else break;
    }
    return l;
  }

  parseUnary() {
    if (
      this.match("punctuation", "!") ||
      this.match("punctuation", "-") ||
      this.match("punctuation", "+")
    ) {
      const op = this.t[this.i - 1].value;
      if (op === "+") return this.parseUnary();
      return {
        type: "UnaryExpression",
        operator: op,
        argument: this.parseUnary(),
      };
    }
    return this.parseCall();
  }

  parseCall() {
    let e = this.parsePrimary();
    while (true) {
      if (this.match("punctuation", "(")) {
        const a = [];
        if (!this.match("punctuation", ")")) {
          do {
            a.push(this.parseExpression());
          } while (this.match("punctuation", ","));
          this.expect("punctuation", ")");
        }
        e = { type: "CallExpression", callee: e, arguments: a };
      } else if (this.match("punctuation", ".")) {
        const prop = this.adv();
        e = { type: "MemberAccess", object: e, property: prop.value };
      } else if (this.match("punctuation", "[")) {
        const ix = this.parseExpression();
        this.expect("punctuation", "]");
        e = { type: "IndexExpression", object: e, index: ix };
      } else if (
        this.peek().type === "punctuation" &&
        this.peek().value === "{"
      ) {
        const lam = this.parseLambda();
        if (e.type === "CallExpression")
          e = {
            type: "CallExpression",
            callee: e.callee,
            arguments: [...e.arguments, lam],
          };
        else e = { type: "CallExpression", callee: e, arguments: [lam] };
      } else break;
    }
    return e;
  }

  parsePrimary() {
    const t = this.peek();
    if (!t) throw new ParseError(`Unexpected end of input`, "?", "?");

    if (t.type === "number" || t.type === "string") {
      this.adv();
      return { type: "Literal", value: t.value };
    }

    if (t.type === "template") {
      this.adv();
      let node = null;
      for (const p of t.parts) {
        const piece =
          p.type === "text"
            ? { type: "Literal", value: p.value }
            : new Parser(new Lexer(p.value).tokenize()).parseExpression();
        node =
          node === null
            ? piece
            : {
              type: "BinaryExpression",
              operator: "+",
              left: node,
              right: piece,
            };
      }
      return node || { type: "Literal", value: "" };
    }

    if (t.type === "keyword" && (t.value === "true" || t.value === "false")) {
      this.adv();
      return { type: "Literal", value: t.value === "true" };
    }

    if (t.type === "keyword" && t.value === "null") {
      this.adv();
      return { type: "Literal", value: null };
    }

    if (t.type === "identifier") {
      this.adv();
      return { type: "Identifier", name: t.value };
    }

    if (t.type === "punctuation" && t.value === "(") {
      this.adv();
      const e = this.parseExpression();
      this.expect("punctuation", ")");
      return e;
    }

    if (t.type === "punctuation" && t.value === "[") {
      this.adv();
      const els = [];
      if (!this.match("punctuation", "]")) {
        do {
          els.push(this.parseExpression());
        } while (this.match("punctuation", ","));
        this.expect("punctuation", "]");
      }
      return { type: "ArrayLiteral", elements: els };
    }

    if (t.type === "punctuation" && t.value === "{") {
      const n1 = this.t[this.i + 1],
        n2 = this.t[this.i + 2];
      const isObj =
        (n1 &&
          (n1.type === "identifier" || n1.type === "string") &&
          n2 &&
          n2.value === ":") ||
        (n1 && n1.value === "}");
      if (isObj) return this.parseObjectLiteral();
      return this.parseLambda();
    }

    if (t.type === "keyword" && t.value === "if") {
      this.adv();
      this.expect("punctuation", "(");
      const test = this.parseExpression();
      this.expect("punctuation", ")");
      const cons = this.parseStatement();
      let alt = null;
      if (this.match("keyword", "else")) alt = this.parseStatement();
      return { type: "IfStatement", test, consequent: cons, alternate: alt };
    }

    if (t.type === "keyword" && t.value === "when") {
      this.adv();
      let d = null;
      if (this.match("punctuation", "(")) {
        d = this.parseExpression();
        this.expect("punctuation", ")");
      }
      this.expect("punctuation", "{");
      const cs = [];
      while (!this.match("punctuation", "}")) {
        if (this.match("keyword", "else")) {
          this.expect("operator", "->");
          cs.push({ isElse: true, result: this.parseExpression() });
        } else {
          const vs = [];
          do {
            vs.push(this.parseExpression());
          } while (this.match("punctuation", ","));
          this.expect("operator", "->");
          cs.push({ values: vs, result: this.parseExpression() });
        }
      }
      return { type: "WhenExpression", discriminant: d, cases: cs };
    }

    // anonymous function expression: fun(params) { body }
    if (t.type === "keyword" && t.value === "fun") {
      this.adv();
      this.expect("punctuation", "(");
      const ps = [];
      let foundDefault = false;
      if (!this.match("punctuation", ")")) {
        do {
          const paramName = this.expect("identifier").value;
          this._skipTypeAnnotation();
          let defaultValue = null;
          if (this.match("punctuation", "=")) {
            defaultValue = this.parseExpression();
            foundDefault = true;
          } else if (foundDefault) {
            throw new ParseError("Non-default parameter cannot follow a default parameter", this.peek().line, this.peek().column);
          }
          ps.push({ name: paramName, defaultValue });
        } while (this.match("punctuation", ","));
        this.expect("punctuation", ")");
      }
      this._skipTypeAnnotation();
      let body;
      if (this.match("punctuation", "=")) {
        const expr = this.parseExpression();
        body = [{ type: "ReturnStatement", argument: expr }];
      } else {
        const stmt = this.parseStatement();
        body = stmt.type === "BlockStatement" ? stmt.body : [stmt];
      }
      return { type: "Lambda", parameters: ps, body };
    }

    throw new ParseError(`Unexpected token '${t.value}'`, t.line, t.column);
  }

  parseLambda() {
    this.expect("punctuation", "{");
    const ps = this._tryLambdaParams() || [];
    const b = [];
    while (!this.match("punctuation", "}")) b.push(this.parseStatement());
    return { type: "Lambda", parameters: ps, body: b };
  }

  parseObjectLiteral() {
    this.expect("punctuation", "{");
    const ps = [];
    if (!this.match("punctuation", "}")) {
      do {
        const k =
          this.peek().type === "string"
            ? this.expect("string").value
            : this.expect("identifier").value;
        this.expect("punctuation", ":");
        ps.push({ key: k, value: this.parseExpression() });
      } while (this.match("punctuation", ","));
      this.expect("punctuation", "}");
    }
    return { type: "ObjectLiteral", properties: ps };
  }
}

// ─── Interpreter ──────────────────────────────────────────────────────────────
class Interpreter {
  constructor() {
    this.globalEnvironment = createGlobalEnvironment();
    // Add include/requireFile here since they need Lexer/Parser
    const e = this.globalEnvironment;
    e.define("include", async (fp) => {
      const code = fs.readFileSync(path.resolve(fp), "utf8");
      const ast = new Parser(new Lexer(code).tokenize()).parseProgram();
      return await this.run(ast, this.globalEnvironment);
    });
    e.define("requireFile", async (fp) => {
      const code = fs.readFileSync(path.resolve(fp), "utf8");
      const ast = new Parser(new Lexer(code).tokenize()).parseProgram();
      const me = new Environment(this.globalEnvironment);
      me.define("exports", new Map());
      await this.run(ast, me);
      return me.lookup("exports");
    });
  }

  _assignSync(target, v, env) {
    if (target.type === "Identifier") {
      env.assign(target.name, v);
    } else {
      return false; // needs async path
    }
    return true;
  }

  async _assign(target, v, env) {
    if (target.type === "Identifier") {
      env.assign(target.name, v);
    } else if (target.type === "MemberAccess") {
      const o = await this.run(target.object, env);
      if (o instanceof TkMap) o.put(target.property, v);
      else o[target.property] = v;
    } else if (target.type === "IndexExpression") {
      const o = await this.run(target.object, env);
      const ix = await this.run(target.index, env);
      if (o instanceof ArrayList) o._a[ix] = v;
      else if (o instanceof TkMap) o.put(ix, v);
      else o[ix] = v;
    } else {
      throw new RuntimeError("Invalid assignment target");
    }
  }

  // Synchronous fast-path for pure-expression nodes — avoids microtask overhead
  _eval(node, env) {
    switch (node.type) {
      case "Literal":
        return node.value;
      case "Identifier":
        return env.lookup(node.name);
      case "BinaryExpression": {
        const l = this._eval(node.left, env);
        if (l === BAIL) return BAIL;
        const r = this._eval(node.right, env);
        if (r === BAIL) return BAIL;
        switch (node.operator) {
          case "+": return l + r;
          case "-": return l - r;
          case "*": return l * r;
          case "/": return l / r;
          case "%": return l % r;
          case "==": return l === r;
          case "!=": return l !== r;
          case "<": return l < r;
          case ">": return l > r;
          case "<=": return l <= r;
          case ">=": return l >= r;
          case "..": return new Range(l, r);
          case "to": return ArrayList._wrap([l, r]);
        }
        return BAIL;
      }
      case "UnaryExpression": {
        const a = this._eval(node.argument, env);
        if (a === BAIL) return BAIL;
        return node.operator === "!" ? !a : -a;
      }
      case "LogicalExpression": {
        const l = this._eval(node.left, env);
        if (l === BAIL) return BAIL;
        if (node.operator === "||") {
          if (l) return l;
          const r = this._eval(node.right, env);
          if (r === BAIL) return BAIL;
          return r;
        }
        if (node.operator === "&&") {
          if (!l) return l;
          const r = this._eval(node.right, env);
          if (r === BAIL) return BAIL;
          return r;
        }
        return BAIL;
      }
      case "MemberAccess": {
        let o = this._eval(node.object, env);
        if (o === BAIL) return BAIL;
        if (o == null) return undefined;
        if (Array.isArray(o) && !(o instanceof ArrayList)) o = ArrayList._wrap(o);
        if (o instanceof TkMap) {
          const method = o[node.property];
          if (method !== undefined)
            return typeof method === "function" ? method.bind(o) : method;
          const val = o.get(node.property);
          if (Array.isArray(val) && !(val instanceof ArrayList)) return ArrayList._wrap(val);
          return val;
        }
        const p = o[node.property];
        const res = typeof p === "function" ? p.bind(o) : p;
        if (Array.isArray(res) && !(res instanceof ArrayList)) return ArrayList._wrap(res);
        return res;
      }
      case "IndexExpression": {
        const obj = this._eval(node.object, env);
        if (obj === BAIL) return BAIL;
        const ix = this._eval(node.index, env);
        if (ix === BAIL) return BAIL;
        let res;
        if (obj instanceof ArrayList) res = obj._a[ix];
        else if (obj instanceof TkMap) res = obj.get(ix);
        else res = obj[ix];
        if (Array.isArray(res) && !(res instanceof ArrayList)) return ArrayList._wrap(res);
        return res;
      }
      case "CompoundAssignment": {
        if (node.left.type === "Identifier") {
          const name = node.left.name;
          let e = env;
          while (e && !(name in e.bindings)) e = e.parent;
          if (!e) throw new RuntimeError(`Undefined variable: ${name}`);
          const cur = e.bindings[name];
          const rhs = this._eval(node.right, env);
          if (rhs === BAIL) return BAIL;
          let v;
          switch (node.operator) {
            case "+=": v = cur + rhs; break;
            case "-=": v = cur - rhs; break;
            case "*=": v = cur * rhs; break;
            case "/=": v = cur / rhs; break;
            default: return BAIL;
          }
          e.bindings[name] = v;
          return v;
        }
        return BAIL;
      }
      case "AssignmentExpression": {
        if (node.left.type === "Identifier") {
          const v = this._eval(node.right, env);
          if (v === BAIL) return BAIL;
          const name = node.left.name;
          let e = env;
          while (e && !(name in e.bindings)) e = e.parent;
          if (!e) throw new RuntimeError(`Undefined variable: ${name}`);
          e.bindings[name] = v;
          return v;
        }
        return BAIL;
      }
    }
    return BAIL;
  }

  async run(node, env = this.globalEnvironment) {
    // Try synchronous fast-path for expression nodes
    const syncTypes = node.type;
    if (
      syncTypes === "Literal" ||
      syncTypes === "Identifier" ||
      syncTypes === "BinaryExpression" ||
      syncTypes === "UnaryExpression" ||
      syncTypes === "LogicalExpression" ||
      syncTypes === "MemberAccess" ||
      syncTypes === "IndexExpression" ||
      syncTypes === "CompoundAssignment" ||
      syncTypes === "AssignmentExpression"
    ) {
      const result = this._eval(node, env);
      if (result !== BAIL) return result;
      // result was undefined — either node.value is undefined (Literal)
      // or _eval bailed. For Literal, we already returned. For others, fall through.
    }

    switch (node.type) {
      case "Program": {
        let r;
        for (const s of node.body) r = await this.run(s, env);
        return r;
      }

      case "EmptyStatement":
        return;

      case "VariableDeclaration": {
        const v = await this.run(node.initializer, env);
        env.define(node.identifier, v);
        return v;
      }

      case "ExpressionStatement":
        return await this.run(node.expression, env);

      case "BlockStatement": {
        if (node._hasDecl === undefined)
          node._hasDecl = node.body.some(s =>
            s.type === "VariableDeclaration" ||
            s.type === "FunctionDeclaration" ||
            s.type === "DataClassDeclaration"
          );
        const be = node._hasDecl ? new Environment(env) : env;
        let r;
        for (const s of node.body) r = await this.run(s, be);
        return r;
      }

      case "ForLoop": {
        const it = await this.run(node.iterable, env);
        const le = new Environment(env);
        if (it instanceof Range) {
          if (node._bodyStmts === undefined) {
            node._bodyStmts = node.body.type === "BlockStatement" ? node.body.body : [node.body];
            node._syncFast = node._bodyStmts.every(s =>
              s.type === "ExpressionStatement" &&
              (s.expression.type === "CompoundAssignment" ||
                s.expression.type === "AssignmentExpression" ||
                s.expression.type === "BinaryExpression" ||
                s.expression.type === "Literal" ||
                s.expression.type === "Identifier")
            );
          }
          const bodyStmts = node._bodyStmts;
          if (node._syncFast) {
            for (let i = it.from; i <= it.to; i++) {
              le.bindings[node.identifier] = i;
              for (let si = 0; si < bodyStmts.length; si++) {
                this._eval(bodyStmts[si].expression, le);
              }
            }
          } else {
            // Fast path: synchronous integer range but async body
            for (let i = it.from; i <= it.to; i++) {
              le.bindings[node.identifier] = i;
              try {
                await this.run(node.body, le);
              } catch (ex) {
                if (ex === BREAK) break;
                if (ex === CONTINUE) continue;
                throw ex;
              }
            }
          }
        } else {
          for await (const v of it) {
            le.bindings[node.identifier] = v;
            try {
              await this.run(node.body, le);
            } catch (ex) {
              if (ex === BREAK) break;
              if (ex === CONTINUE) continue;
              throw ex;
            }
          }
        }
        return;
      }

      case "WhileLoop": {
        if (node._bodyStmts === undefined) {
          node._bodyStmts = node.body.type === "BlockStatement" ? node.body.body : [node.body];
          node._syncFast = node._bodyStmts.every(s =>
            s.type === "ExpressionStatement" &&
            (s.expression.type === "CompoundAssignment" ||
              s.expression.type === "AssignmentExpression" ||
              s.expression.type === "BinaryExpression" ||
              s.expression.type === "Literal" ||
              s.expression.type === "Identifier")
          );
        }
        const bodyStmts = node._bodyStmts;
        if (node._syncFast) {
          while (true) {
            let t = this._eval(node.test, env);
            if (t === BAIL) t = await this.run(node.test, env);
            if (!t) break;
            for (let si = 0; si < bodyStmts.length; si++) {
              this._eval(bodyStmts[si].expression, env);
            }
          }
        } else {
          while (true) {
            let t = this._eval(node.test, env);
            if (t === BAIL) t = await this.run(node.test, env);
            if (!t) break;
            try {
              await this.run(node.body, env);
            } catch (ex) {
              if (ex === BREAK) break;
              if (ex === CONTINUE) continue;
              throw ex;
            }
          }
        }
        return;
      }

      case "BreakStatement":
        throw BREAK;
      case "ContinueStatement":
        throw CONTINUE;

      case "ReturnStatement": {
        let v;
        if (node.argument) {
          v = this._eval(node.argument, env);
          if (v === BAIL) v = await this.run(node.argument, env);
        }
        throw new ReturnSignal(v);
      }

      case "IfStatement": {
        let t = this._eval(node.test, env);
        if (t === BAIL) t = await this.run(node.test, env);
        if (t) return await this.run(node.consequent, env);
        if (node.alternate) return await this.run(node.alternate, env);
        return null;
      }

      case "DataClassDeclaration": {
        const proto = {};
        const _name = node.name;
        const _fields = node.fields;
        proto.toString = function () {
          return `${_name}(${_fields.map((f) => `${f.name}=${tkStr(this[f.name])}`).join(", ")})`;
        };
        proto.toJson = function (p) {
          return JSON.stringify(this, null, p ? 2 : 0);
        };
        const factory = async (...args) => {
          const o = Object.create(proto);
          const fe = new Environment(env);
          for (let i = 0; i < _fields.length; i++) {
            const f = _fields[i];
            let val = args[i];
            if (val === undefined && f.defaultValue) {
              val = await this.run(f.defaultValue, fe);
            }
            if (val === undefined) val = null;
            o[f.name] = val;
            fe.define(f.name, val); // allow later default values to refer to earlier ones
          }
          return o;
        };
        factory.defineMethod = (n, fn) => {
          proto[n] = function (...a) {
            return fn(this, ...a);
          };
          return factory;
        };
        env.define(_name, factory);
        return;
      }

      case "FunctionDeclaration": {
        const fn = async (...a) => {
          const fe = new Environment(env);
          for (let i = 0; i < node.parameters.length; i++) {
            const param = node.parameters[i];
            let val = a[i];
            if (val === undefined && param.defaultValue) {
              val = await this.run(param.defaultValue, fe);
            }
            fe.define(param.name, val);
          }
          try {
            if (node.body.type === "BlockStatement") {
              let r;
              for (const s of node.body.body) r = await this.run(s, fe);
              return r;
            }
            return await this.run(node.body, fe);
          } catch (ex) {
            if (ex instanceof ReturnSignal) return ex.value;
            throw ex;
          }
        };
        if (node.receiver) {
          const tt = env.lookup(node.receiver.typeName);
          const mf = async (rec, ...a) => {
            const me = new Environment(env);
            me.define(node.receiver.name, rec);
            for (let i = 0; i < node.parameters.length; i++) {
              const param = node.parameters[i];
              let val = a[i];
              if (val === undefined && param.defaultValue) {
                val = await this.run(param.defaultValue, me);
              }
              me.define(param.name, val);
            }
            try {
              if (node.body.type === "BlockStatement") {
                let r;
                for (const s of node.body.body) r = await this.run(s, me);
                return r;
              }
              return await this.run(node.body, me);
            } catch (ex) {
              if (ex instanceof ReturnSignal) return ex.value;
              throw ex;
            }
          };
          tt.defineMethod(node.name, mf);
        } else {
          env.define(node.name, fn);
        }
        return;
      }

      case "AssignmentExpression": {
        const v = await this.run(node.right, env);
        await this._assign(node.left, v, env);
        return v;
      }

      case "CompoundAssignment": {
        const cur = await this.run(node.left, env);
        const rhs = await this.run(node.right, env);
        let v;
        switch (node.operator) {
          case "+=":
            v = cur + rhs;
            break;
          case "-=":
            v = cur - rhs;
            break;
          case "*=":
            v = cur * rhs;
            break;
          case "/=":
            v = cur / rhs;
            break;
          default:
            throw new RuntimeError(
              `Unknown compound operator: ${node.operator}`,
            );
        }
        await this._assign(node.left, v, env);
        return v;
      }

      case "BinaryExpression": {
        const l = await this.run(node.left, env);
        const r = await this.run(node.right, env);
        switch (node.operator) {
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/":
            return l / r;
          case "%":
            return l % r;
          case "==":
            return l === r;
          case "!=":
            return l !== r;
          case "<":
            return l < r;
          case ">":
            return l > r;
          case "<=":
            return l <= r;
          case ">=":
            return l >= r;
          case "..":
            return new Range(l, r);
          case "to":
            return ArrayList._wrap([l, r]);
        }
        break;
      }

      case "LogicalExpression": {
        const l = await this.run(node.left, env);
        if (node.operator === "||")
          return l ? l : await this.run(node.right, env);
        if (node.operator === "&&")
          return l ? await this.run(node.right, env) : l;
        break;
      }

      case "UnaryExpression": {
        const a = await this.run(node.argument, env);
        return node.operator === "!" ? !a : -a;
      }

      case "Literal":
        return node.value;
      case "Identifier":
        return env.lookup(node.name);

      case "CallExpression": {
        const callee = await this.run(node.callee, env);
        if (typeof callee !== "function") {
          const name = node.callee.type === "MemberAccess" ? node.callee.property :
                       node.callee.type === "Identifier" ? node.callee.name : "Expression";
          throw new RuntimeError(`${name} is not a function`);
        }
        const argc = node.arguments.length;
        const a = new Array(argc);
        for (let i = 0; i < argc; i++) {
          a[i] = await this.run(node.arguments[i], env);
        }
        const r = callee(...a);
        let result = r instanceof Promise ? await r : r;
        if (Array.isArray(result) && !(result instanceof ArrayList)) {
          result = ArrayList._wrap(result);
        }
        return result;
      }

      case "MemberAccess": {
        let o = await this.run(node.object, env);
        if (o == null) return undefined;
        if (Array.isArray(o) && !(o instanceof ArrayList)) o = ArrayList._wrap(o);
        if (o instanceof TkMap) {
          const method = o[node.property];
          if (method !== undefined)
            return typeof method === "function" ? method.bind(o) : method;
          const val = o.get(node.property);
          if (Array.isArray(val) && !(val instanceof ArrayList)) return ArrayList._wrap(val);
          return val;
        }
        const p = o[node.property];
        const res = typeof p === "function" ? p.bind(o) : p;
        if (Array.isArray(res) && !(res instanceof ArrayList)) return ArrayList._wrap(res);
        return res;
      }

      case "IndexExpression": {
        const obj = await this.run(node.object, env);
        const ix = await this.run(node.index, env);
        let res;
        if (obj instanceof ArrayList) res = obj._a[ix];
        else if (obj instanceof TkMap) res = obj.get(ix);
        else res = obj[ix];
        if (Array.isArray(res) && !(res instanceof ArrayList)) return ArrayList._wrap(res);
        return res;
      }

      case "ArrayLiteral": {
        const elements = [];
        for (let i = 0; i < node.elements.length; i++) {
          elements.push(await this.run(node.elements[i], env));
        }
        return ArrayList._wrap(elements);
      }

      case "ObjectLiteral": {
        const o = {};
        for (const p of node.properties)
          o[p.key] = await this.run(p.value, env);
        return o;
      }

      case "Lambda":
        return async (...ca) => {
          const le = new Environment(env);
          if (node.parameters.length > 0) {
            for (let i = 0; i < node.parameters.length; i++) {
              const param = node.parameters[i];
              let val = ca[i];
              if (val === undefined && param.defaultValue) {
                val = await this.run(param.defaultValue, le);
              }
              le.define(param.name, val);
            }
          } else le.define("it", ca[0]);
          try {
            if (node.body.type === "BlockStatement") {
              let r;
              for (const s of node.body.body) r = await this.run(s, le);
              return r;
            } else if (Array.isArray(node.body)) {
              let r;
              for (const s of node.body) r = await this.run(s, le);
              return r;
            } else {
              return await this.run(node.body, le);
            }
          } catch (ex) {
            if (ex instanceof ReturnSignal) return ex.value;
            throw ex;
          }
        };

      case "WhenExpression": {
        const d = node.discriminant
          ? await this.run(node.discriminant, env)
          : true;
        for (const c of node.cases) {
          if (c.isElse) return await this.run(c.result, env);
          for (const v of c.values) {
            if ((await this.run(v, env)) === d)
              return await this.run(c.result, env);
          }
        }
        return null;
      }
    }
  }
}

if (require.main === module) {
  if (process.argv.length < 3) {
    console.log("usage: node interpreter.js file");
    process.exit(1);
  }

  (async () => {
    try {
      const src = fs.readFileSync(process.argv[2], "utf8");
      const ast = new Parser(new Lexer(src).tokenize()).parseProgram();
      await new Interpreter().run(ast);
    } catch (ex) {
      console.error(ex.message ?? ex);
      process.exit(1);
    }
  })();
} else {
  module.exports = {
    Lexer,
    Parser,
    Interpreter,
    Environment,
    TkMap,
    TkSet,
    ArrayList,
    Sequence,
    Range
  };
}
