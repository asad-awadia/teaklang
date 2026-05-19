#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { Lexer, Parser, Interpreter } = require("../interpreter.js");

const testDir = path.join(__dirname, "cases");
const examplesDir = path.join(__dirname, "..", "examples");

// Examples that start long-running servers — skip them in test runs
const skipExamples = new Set(["12-http-server.tk"]);

function discover(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".tk"))
    .map(f => path.join(dir, f));
}

async function runFile(filepath) {
  const src = fs.readFileSync(filepath, "utf8");
  const ast = new Parser(new Lexer(src).tokenize()).parseProgram();
  const interp = new Interpreter();

  interp.globalEnvironment.define("assert", function(cond, msg) {
    if (!cond) {
      throw new Error(msg || "assertion failed");
    }
  });

  await interp.run(ast);
}

async function main() {
  const testFiles = discover(testDir);
  const exampleFiles = discover(examplesDir).filter(f => !skipExamples.has(path.basename(f)));
  const files = [...testFiles, ...exampleFiles];

  if (files.length === 0) {
    console.log("No test cases or examples found.");
    process.exit(0);
  }

  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const label = path.relative(path.join(__dirname, ".."), file);
    try {
      await runFile(file);
      console.log("  PASS  " + label);
      passed++;
    } catch (ex) {
      console.error("  FAIL  " + label);
      console.error("        " + (ex.message ?? ex));
      failed++;
    }
  }

  console.log("\n" + passed + " passed, " + failed + " failed, " + (passed + failed) + " total");
  process.exit(failed > 0 ? 1 : 0);
}

main();
