"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { RBTree } = require("bintrees");

if (!String.prototype.contains)
  String.prototype.contains = String.prototype.includes;

class RuntimeError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "RuntimeError";
  }
}

// ─── TkMap ────────────────────────────────────────────────────────────────────
class TkMap {
  constructor(entries = []) {
    this._m = new Map(entries);
  }
  get(k) {
    return this._m.has(k) ? this._m.get(k) : null;
  }
  put(k, v) {
    this._m.set(k, v);
    return this;
  }
  set(k, v) {
    return this.put(k, v);
  }
  remove(k) {
    return this._m.delete(k);
  }
  containsKey(k) {
    return this._m.has(k);
  }
  containsValue(v) {
    for (const val of this._m.values()) if (val === v) return true;
    return false;
  }
  keys() {
    return new ArrayList([...this._m.keys()]);
  }
  values() {
    return new ArrayList([...this._m.values()]);
  }
  entries() {
    return new ArrayList([...this._m.entries()]);
  }
  size() {
    return this._m.size;
  }
  isEmpty() {
    return this._m.size === 0;
  }
  async forEach(fn) {
    for (const [k, v] of this._m) await fn(k, v);
  }
  async mapValues(fn) {
    const r = new TkMap();
    for (const [k, v] of this._m) r.put(k, await fn(v));
    return r.toMap();
  }
  async mapKeys(fn) {
    const r = new TkMap();
    for (const [k, v] of this._m) r.put(await fn(k), v);
    return r.toMap();
  }
  [Symbol.iterator]() {
    return this._m.entries();
  }
  async map(fn) {
    const r = [];
    for (const [k, v] of this._m) r.push(await fn({ key: k, value: v }));
    return ArrayList._wrap(r);
  }
  async filter(fn) {
    const r = new TkMap();
    for (const [k, v] of this._m) {
      if (await fn({ key: k, value: v })) r.put(k, v);
    }
    return r.toMap();
  }
  async filterNot(fn) {
    const r = new TkMap();
    for (const [k, v] of this._m) {
      if (!(await fn({ key: k, value: v }))) r.put(k, v);
    }
    return r.toMap();
  }
  async any(fn) {
    for (const [k, v] of this._m) if (await fn({ key: k, value: v })) return true;
    return false;
  }
  async all(fn) {
    for (const [k, v] of this._m) if (!(await fn({ key: k, value: v }))) return false;
    return true;
  }
  async none(fn) {
    for (const [k, v] of this._m) if (await fn({ key: k, value: v })) return false;
    return true;
  }
  async find(fn) {
    for (const [k, v] of this._m) if (await fn({ key: k, value: v })) return { key: k, value: v };
    return null;
  }
  async count(fn) {
    if (!fn) return this._m.size;
    let c = 0;
    for (const [k, v] of this._m) if (await fn({ key: k, value: v })) c++;
    return c;
  }
  toMap() {
    return new ImmutableMap([...this._m.entries()]);
  }
  toMutableMap() {
    return new TkMap([...this._m.entries()]);
  }
  toString() {
    return (
      "{" +
      [...this._m.entries()].map(([k, v]) => `${k}: ${tkStr(v)}`).join(", ") +
      "}"
    );
  }
  toJSON() {
    return Object.fromEntries(this._m);
  }
}

class ImmutableMap extends TkMap {
  toMap() {
    return this;
  }
}
for (const m of ["put", "set", "remove"]) ImmutableMap.prototype[m] = undefined;

// ─── Runtime helpers ──────────────────────────────────────────────────────────
function tkStr(v) {
  if (v instanceof ArrayList) return v.toString();
  if (v instanceof TkMap) return v.toString();
  if (v instanceof TkSet) return v.toString();
  if (Array.isArray(v)) return "[" + v.map(tkStr).join(", ") + "]";
  if (v !== null && typeof v === "object" && !(v instanceof Promise)) {
    if (
      typeof v.toString === "function" &&
      v.toString !== Object.prototype.toString
    )
      return v.toString();
    return (
      "{" +
      Object.entries(v)
        .map(([k, val]) =>
          typeof val === "function" ? null : `${k}: ${tkStr(val)}`,
        )
        .filter((x) => x !== null)
        .join(", ") +
      "}"
    );
  }
  return v === null ? "null" : String(v);
}

class Environment {
  constructor(p = null) {
    this.parent = p;
    this.bindings = Object.create(null);
  }
  lookup(n) {
    let env = this;
    while (env) {
      if (n in env.bindings) return env.bindings[n];
      env = env.parent;
    }
    throw new RuntimeError(`Undefined variable: ${n}`);
  }
  define(n, v) {
    this.bindings[n] = v;
  }
  assign(n, v) {
    let env = this;
    while (env) {
      if (n in env.bindings) {
        env.bindings[n] = v;
        return;
      }
      env = env.parent;
    }
    throw new RuntimeError(`Undefined variable: ${n}`);
  }
}

// ─── ArrayList ────────────────────────────────────────────────────────────────
class ArrayList {
  constructor(items = []) {
    this._a = items instanceof ArrayList ? items._a.slice() : Array.isArray(items) ? items.slice() : [...items];
  }
  static _wrap(arr) {
    const a = new ArrayList();
    a._a = arr;
    return a;
  }

  // Mutation
  add(x) {
    this._a.push(x);
    return this;
  }
  addAll(xs) {
    for (const x of xs instanceof ArrayList ? xs._a : xs) this._a.push(x);
    return this;
  }
  set(i, v) {
    this._a[i] = v;
    return this;
  }
  remove(x) {
    const i = this._a.indexOf(x);
    if (i < 0) return false;
    this._a.splice(i, 1);
    return true;
  }
  removeAt(i) {
    return this._a.splice(i, 1)[0];
  }
  clear() {
    this._a.length = 0;
    return this;
  }
  sort(fn) {
    this._a.sort(fn);
    return this;
  }

  // Access
  get(i) {
    return this._a[i];
  }
  size() {
    return this._a.length;
  }
  isEmpty() {
    return this._a.length === 0;
  }
  contains(x) {
    return this._a.includes(x);
  }
  indexOf(x) {
    return this._a.indexOf(x);
  }
  lastIndexOf(x) {
    return this._a.lastIndexOf(x);
  }
  async first(p) {
    if (!p) return this._a[0] ?? null;
    for (const v of this._a) if (await p(v)) return v;
    return null;
  }
  async last(p) {
    if (!p) return this._a[this._a.length - 1] ?? null;
    let r = null;
    for (const v of this._a) if (await p(v)) r = v;
    return r;
  }
  head() {
    return this._a[0] ?? null;
  }

  // Slicing
  take(n) {
    return new ArrayList(this._a.slice(0, n));
  }
  drop(n) {
    return new ArrayList(this._a.slice(n));
  }
  rest() {
    return new ArrayList(this._a.slice(1));
  }
  reversed() {
    return new ArrayList([...this._a].reverse());
  }
  chunked(n) {
    const r = [];
    for (let i = 0; i < this._a.length; i += n)
      r.push(new ArrayList(this._a.slice(i, i + n)));
    return new ArrayList(r);
  }
  windowed(n, step = 1) {
    const r = [];
    for (let i = 0; i <= this._a.length - n; i += step)
      r.push(new ArrayList(this._a.slice(i, i + n)));
    return new ArrayList(r);
  }
  zip(other) {
    const o = other instanceof ArrayList ? other._a : [...other];
    const len = Math.min(this._a.length, o.length);
    return new ArrayList(this._a.slice(0, len).map((v, i) => [v, o[i]]));
  }

  // Sorting (non-mutating)
  sorted() {
    return new ArrayList(
      [...this._a].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  sortedDescending() {
    return new ArrayList(
      [...this._a].sort((a, b) => (b < a ? -1 : b > a ? 1 : 0)),
    );
  }
  async sortedBy(fn) {
    const keyed = await Promise.all(this._a.map(async (v) => [v, await fn(v)]));
    keyed.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return new ArrayList(keyed.map((x) => x[0]));
  }
  async sortedByDescending(fn) {
    const keyed = await Promise.all(this._a.map(async (v) => [v, await fn(v)]));
    keyed.sort((a, b) => (b[1] < a[1] ? -1 : b[1] > a[1] ? 1 : 0));
    return new ArrayList(keyed.map((x) => x[0]));
  }
  async sortedWith(cmp) {
    const copy = [...this._a];
    async function merge(arr, l, m, r) {
      const left = arr.slice(l, m + 1);
      const right = arr.slice(m + 1, r + 1);
      let i = 0, j = 0, k = l;
      while (i < left.length && j < right.length) {
        if ((await cmp(left[i], right[j])) <= 0) arr[k++] = left[i++];
        else arr[k++] = right[j++];
      }
      while (i < left.length) arr[k++] = left[i++];
      while (j < right.length) arr[k++] = right[j++];
    }
    async function mergeSort(arr, l, r) {
      if (l >= r) return;
      const m = (l + r) >> 1;
      await mergeSort(arr, l, m);
      await mergeSort(arr, m + 1, r);
      await merge(arr, l, m, r);
    }
    await mergeSort(copy, 0, copy.length - 1);
    return ArrayList._wrap(copy);
  }

  // Distinct
  distinct() {
    return new ArrayList([...new Set(this._a)]);
  }
  async distinctBy(fn) {
    const seen = new Set();
    const r = [];
    for (const v of this._a) {
      const k = await fn(v);
      if (!seen.has(k)) {
        seen.add(k);
        r.push(v);
      }
    }
    return new ArrayList(r);
  }

  // Filtering
  async filter(p) {
    const r = [];
    for (const v of this._a) if (await p(v)) r.push(v);
    return new ArrayList(r);
  }
  async filterNot(p) {
    const r = [];
    for (const v of this._a) if (!(await p(v))) r.push(v);
    return new ArrayList(r);
  }
  filterNotNull() {
    return new ArrayList(this._a.filter((v) => v != null));
  }
  async takeWhile(p) {
    const r = [];
    for (const v of this._a) {
      if (!(await p(v))) break;
      r.push(v);
    }
    return new ArrayList(r);
  }
  async dropWhile(p) {
    let i = 0;
    while (i < this._a.length && (await p(this._a[i]))) i++;
    return new ArrayList(this._a.slice(i));
  }

  // Predicates
  async any(p) {
    for (const v of this._a) if (await p(v)) return true;
    return false;
  }
  async all(p) {
    for (const v of this._a) if (!(await p(v))) return false;
    return true;
  }
  async none(p) {
    for (const v of this._a) if (await p(v)) return false;
    return true;
  }
  async find(p) {
    for (const v of this._a) if (await p(v)) return v;
    return null;
  }

  // Iteration
  async forEach(f) {
    for (const v of this._a) await f(v);
  }
  async forEachIndexed(f) {
    for (let i = 0; i < this._a.length; i++) await f(i, this._a[i]);
  }
  async onEach(f) {
    for (const v of this._a) await f(v);
    return this;
  }

  // Mapping
  async map(f) {
    const r = [];
    for (const v of this._a) r.push(await f(v));
    return new ArrayList(r);
  }
  async mapIndexed(f) {
    const r = [];
    for (let i = 0; i < this._a.length; i++) r.push(await f(i, this._a[i]));
    return new ArrayList(r);
  }
  async mapNotNull(f) {
    const r = [];
    for (const v of this._a) {
      const x = await f(v);
      if (x != null) r.push(x);
    }
    return new ArrayList(r);
  }
  async flatMap(f) {
    const r = [];
    for (const v of this._a) {
      const x = await f(v);
      if (x instanceof ArrayList) r.push(...x._a);
      else if (Array.isArray(x)) r.push(...x);
      else r.push(x);
    }
    return new ArrayList(r);
  }
  flatten() {
    const r = [];
    for (const v of this._a) {
      if (v instanceof ArrayList) r.push(...v._a);
      else if (Array.isArray(v)) r.push(...v);
      else r.push(v);
    }
    return new ArrayList(r);
  }

  // Reduction
  async reduce(f, init) {
    let a = init;
    for (let i = 0; i < this._a.length; i++)
      a = i === 0 && a === undefined ? this._a[i] : await f(a, this._a[i]);
    return a;
  }
  async fold(init, f) {
    let a = init;
    for (const v of this._a) a = await f(a, v);
    return a;
  }
  sum() {
    return this._a.reduce((a, b) => a + Number(b), 0);
  }
  async sumOf(f) {
    let s = 0;
    for (const v of this._a) s += Number(await f(v));
    return s;
  }
  average() {
    return this._a.length === 0 ? NaN : this.sum() / this._a.length;
  }
  async count(p) {
    if (!p) return this._a.length;
    let c = 0;
    for (const v of this._a) if (await p(v)) c++;
    return c;
  }
  maxOrNull() {
    return this._a.length === 0
      ? null
      : this._a.reduce((a, b) => (b > a ? b : a));
  }
  minOrNull() {
    return this._a.length === 0
      ? null
      : this._a.reduce((a, b) => (b < a ? b : a));
  }
  async maxByOrNull(f) {
    if (!this._a.length) return null;
    let bv = this._a[0],
      bk = await f(bv);
    for (let i = 1; i < this._a.length; i++) {
      const k = await f(this._a[i]);
      if (k > bk) {
        bk = k;
        bv = this._a[i];
      }
    }
    return bv;
  }
  async minByOrNull(f) {
    if (!this._a.length) return null;
    let bv = this._a[0],
      bk = await f(bv);
    for (let i = 1; i < this._a.length; i++) {
      const k = await f(this._a[i]);
      if (k < bk) {
        bk = k;
        bv = this._a[i];
      }
    }
    return bv;
  }

  // Grouping
  async groupBy(f) {
    const m = new TkMap();
    for (const v of this._a) {
      const k = await f(v);
      if (!m.containsKey(k)) m.put(k, new ArrayList());
      m.get(k).add(v);
    }
    return m.toMap();
  }
  async associate(f) {
    const m = new TkMap();
    for (const v of this._a) {
      const res = await f(v);
      if (Array.isArray(res) || res instanceof ArrayList) {
        const [k, w] = res;
        m.put(k, w);
      }
    }
    return m.toMap();
  }
  async associateBy(f) {
    const m = new TkMap();
    for (const v of this._a) {
      const k = await f(v);
      m.put(k, v);
    }
    return m.toMap();
  }
  async partition(p) {
    const a = [],
      b = [];
    for (const v of this._a) ((await p(v)) ? a : b).push(v);
    return [new ArrayList(a), new ArrayList(b)];
  }
  async joinToString(sep = ", ", prefix = "", postfix = "") {
    return prefix + this._a.join(sep) + postfix;
  }

  // Conversion
  toList() {
    return new ImmutableList(this._a);
  }
  toMutableList() {
    return new ArrayList(this._a);
  }
  toSet() {
    return new ImmutableSet(this._a);
  }
  toMutableSet() {
    return new TkSet(this._a);
  }
  toMap() {
    const m = new TkMap();
    for (const item of this._a) {
      if (Array.isArray(item) || item instanceof ArrayList) {
        const [k, v] = item;
        m.put(k, v);
      }
    }
    return m.toMap();
  }
  toSequence() {
    const a = this._a;
    return new Sequence(() => a);
  }
  asSequence() {
    return this.toSequence();
  }

  [Symbol.iterator]() {
    return this._a[Symbol.iterator]();
  }
  toString() {
    return `[${this._a.map(tkStr).join(", ")}]`;
  }
  toJSON() {
    return this._a;
  }
}

// ─── ImmutableList ────────────────────────────────────────────────────────────
class ImmutableList extends ArrayList {
  toList() {
    return this;
  }
  toMutableList() {
    return new ArrayList(this._a);
  }
}
// hide mutation methods so they don't appear on ImmutableList instances
for (const m of ["add", "addAll", "set", "remove", "removeAt", "clear", "sort"])
  ImmutableList.prototype[m] = undefined;

// ─── TkSet ────────────────────────────────────────────────────────────────────
class TkSet {
  constructor(items = []) {
    this._s = new Set(items);
  }
  add(x) {
    this._s.add(x);
    return this;
  }
  remove(x) {
    return this._s.delete(x);
  }
  clear() {
    this._s.clear();
    return this;
  }
  contains(x) {
    return this._s.has(x);
  }
  size() {
    return this._s.size;
  }
  isEmpty() {
    return this._s.size === 0;
  }
  async forEach(f) {
    for (const v of this._s) await f(v);
  }
  async filter(p) {
    const r = new TkSet();
    for (const v of this._s) if (await p(v)) r._s.add(v);
    return r;
  }
  async map(f) {
    const r = new TkSet();
    for (const v of this._s) r._s.add(await f(v));
    return r;
  }
  async any(p) {
    for (const v of this._s) if (await p(v)) return true;
    return false;
  }
  async all(p) {
    for (const v of this._s) if (!(await p(v))) return false;
    return true;
  }
  async none(p) {
    for (const v of this._s) if (await p(v)) return false;
    return true;
  }
  union(other) {
    return new TkSet([
      ...this._s,
      ...(other instanceof TkSet ? other._s : other),
    ]);
  }
  intersect(other) {
    const o = other instanceof TkSet ? other._s : new Set(other);
    return new TkSet([...this._s].filter((x) => o.has(x)));
  }
  subtract(other) {
    const o = other instanceof TkSet ? other._s : new Set(other);
    return new TkSet([...this._s].filter((x) => !o.has(x)));
  }
  toList() {
    return new ImmutableList([...this._s]);
  }
  toMutableList() {
    return new ArrayList([...this._s]);
  }
  toSet() {
    return new ImmutableSet([...this._s]);
  }
  toMutableSet() {
    return new TkSet([...this._s]);
  }
  [Symbol.iterator]() {
    return this._s[Symbol.iterator]();
  }
  toString() {
    return "[" + [...this._s].map(tkStr).join(", ") + "]";
  }
  toJSON() {
    return [...this._s];
  }
}

class ImmutableSet extends TkSet {
  toSet() {
    return this;
  }
  toMutableSet() {
    return new TkSet([...this._s]);
  }
}
for (const m of ["add", "remove", "clear"])
  ImmutableSet.prototype[m] = undefined;

// ─── Sequence ─────────────────────────────────────────────────────────────────
class Sequence {
  constructor(sourceFn) {
    this._sourceFn = sourceFn;
  }
  async *[Symbol.asyncIterator]() {
    const src = this._sourceFn();
    if (src[Symbol.asyncIterator]) for await (const v of src) yield v;
    else for (const v of src) yield v;
  }

  // Lazy transforms
  map(fn) {
    const s = this;
    return new Sequence(async function* () {
      for await (const v of s) yield await fn(v);
    });
  }
  mapIndexed(fn) {
    const s = this;
    return new Sequence(async function* () {
      let i = 0;
      for await (const v of s) yield await fn(i++, v);
    });
  }
  mapNotNull(fn) {
    const s = this;
    return new Sequence(async function* () {
      for await (const v of s) {
        const x = await fn(v);
        if (x != null) yield x;
      }
    });
  }
  flatMap(fn) {
    const s = this;
    return new Sequence(async function* () {
      for await (const v of s) {
        const x = await fn(v);
        if (x instanceof Sequence) for await (const e of x) yield e;
        else if (x instanceof ArrayList) for (const e of x._a) yield e;
        else if (Array.isArray(x)) for (const e of x) yield e;
        else yield x;
      }
    });
  }
  flatten() {
    const s = this;
    return new Sequence(async function* () {
      for await (const v of s) {
        if (v instanceof Sequence) for await (const e of v) yield e;
        else if (v instanceof ArrayList) for (const e of v._a) yield e;
        else if (Array.isArray(v)) for (const e of v) yield e;
        else yield v;
      }
    });
  }
  filter(pred) {
    const s = this;
    return new Sequence(async function* () {
      for await (const v of s) if (await pred(v)) yield v;
    });
  }
  filterNot(pred) {
    const s = this;
    return new Sequence(async function* () {
      for await (const v of s) if (!(await pred(v))) yield v;
    });
  }
  filterNotNull() {
    const s = this;
    return new Sequence(async function* () {
      for await (const v of s) if (v != null) yield v;
    });
  }
  take(n) {
    const s = this;
    return new Sequence(async function* () {
      let i = 0;
      for await (const v of s) {
        if (i++ >= n) break;
        yield v;
      }
    });
  }
  takeWhile(p) {
    const s = this;
    return new Sequence(async function* () {
      for await (const v of s) {
        if (!(await p(v))) break;
        yield v;
      }
    });
  }
  drop(n) {
    const s = this;
    return new Sequence(async function* () {
      let i = 0;
      for await (const v of s) if (i++ >= n) yield v;
    });
  }
  dropWhile(p) {
    const s = this;
    return new Sequence(async function* () {
      let d = true;
      for await (const v of s) {
        if (d && (await p(v))) continue;
        d = false;
        yield v;
      }
    });
  }
  distinct() {
    const s = this;
    return new Sequence(async function* () {
      const seen = new Set();
      for await (const v of s)
        if (!seen.has(v)) {
          seen.add(v);
          yield v;
        }
    });
  }
  distinctBy(fn) {
    const s = this;
    return new Sequence(async function* () {
      const seen = new Set();
      for await (const v of s) {
        const k = await fn(v);
        if (!seen.has(k)) {
          seen.add(k);
          yield v;
        }
      }
    });
  }
  onEach(fn) {
    const s = this;
    return new Sequence(async function* () {
      for await (const v of s) {
        await fn(v);
        yield v;
      }
    });
  }
  chunked(n) {
    const s = this;
    return new Sequence(async function* () {
      let buf = [];
      for await (const v of s) {
        buf.push(v);
        if (buf.length === n) {
          yield new ArrayList(buf);
          buf = [];
        }
      }
      if (buf.length) yield new ArrayList(buf);
    });
  }
  windowed(n, step = 1) {
    const s = this;
    return new Sequence(async function* () {
      const buf = [];
      for await (const v of s) {
        buf.push(v);
        if (buf.length === n) {
          yield new ArrayList([...buf]);
          for (let i = 0; i < step; i++) buf.shift();
        }
      }
    });
  }
  zip(other) {
    const s = this;
    return new Sequence(async function* () {
      let arr;
      if (other instanceof ArrayList) arr = other._a;
      else if (Array.isArray(other)) arr = other;
      else {
        arr = [];
        for await (const v of other) arr.push(v);
      }
      let i = 0;
      for await (const v of s) {
        if (i >= arr.length) break;
        yield [v, arr[i++]];
      }
    });
  }

  // Terminal ops
  async reduce(f, init) {
    let a = init,
      started = init !== undefined;
    for await (const v of this) {
      a = started ? await f(a, v) : v;
      started = true;
    }
    return a;
  }
  async fold(init, f) {
    let a = init;
    for await (const v of this) a = await f(a, v);
    return a;
  }
  async sum() {
    let s = 0;
    for await (const v of this) s += Number(v);
    return s;
  }
  async sumOf(f) {
    let s = 0;
    for await (const v of this) s += Number(await f(v));
    return s;
  }
  async average() {
    let s = 0,
      c = 0;
    for await (const v of this) {
      s += Number(v);
      c++;
    }
    return c === 0 ? NaN : s / c;
  }
  async count(p) {
    let c = 0;
    for await (const v of this) if (!p || (await p(v))) c++;
    return c;
  }
  async forEach(f) {
    for await (const v of this) await f(v);
  }
  async forEachIndexed(f) {
    let i = 0;
    for await (const v of this) await f(i++, v);
  }
  async any(p) {
    for await (const v of this) if (await p(v)) return true;
    return false;
  }
  async all(p) {
    for await (const v of this) if (!(await p(v))) return false;
    return true;
  }
  async none(p) {
    for await (const v of this) if (await p(v)) return false;
    return true;
  }
  async find(p) {
    for await (const v of this) if (await p(v)) return v;
    return null;
  }
  async first(p) {
    for await (const v of this) if (!p || (await p(v))) return v;
    return null;
  }
  async last(p) {
    let r = null;
    for await (const v of this) if (!p || (await p(v))) r = v;
    return r;
  }
  async maxOrNull() {
    let m = null;
    for await (const v of this) if (m === null || v > m) m = v;
    return m;
  }
  async minOrNull() {
    let m = null;
    for await (const v of this) if (m === null || v < m) m = v;
    return m;
  }
  async maxByOrNull(f) {
    let bv = null,
      bk;
    for await (const v of this) {
      const k = await f(v);
      if (bv === null || k > bk) {
        bk = k;
        bv = v;
      }
    }
    return bv;
  }
  async minByOrNull(f) {
    let bv = null,
      bk;
    for await (const v of this) {
      const k = await f(v);
      if (bv === null || k < bk) {
        bk = k;
        bv = v;
      }
    }
    return bv;
  }
  async groupBy(f) {
    const m = new TkMap();
    for await (const v of this) {
      const k = await f(v);
      if (!m.containsKey(k)) m.put(k, new ArrayList());
      m.get(k).add(v);
    }
    return m.toMap();
  }
  async associate(f) {
    const m = new TkMap();
    for await (const v of this) {
      const res = await f(v);
      if (Array.isArray(res) || res instanceof ArrayList) {
        const [k, w] = res;
        m.put(k, w);
      }
    }
    return m.toMap();
  }
  async associateBy(f) {
    const m = new TkMap();
    for await (const v of this) {
      const k = await f(v);
      m.put(k, v);
    }
    return m.toMap();
  }
  async partition(p) {
    const a = [],
      b = [];
    for await (const v of this) ((await p(v)) ? a : b).push(v);
    return [new ArrayList(a), new ArrayList(b)];
  }
  async joinToString(sep = ", ", prefix = "", postfix = "") {
    const parts = [];
    for await (const v of this) parts.push(String(v));
    return prefix + parts.join(sep) + postfix;
  }
  async toList() {
    const out = [];
    for await (const v of this) out.push(v);
    return new ImmutableList(out);
  }
  async toMutableList() {
    const out = [];
    for await (const v of this) out.push(v);
    return new ArrayList(out);
  }
  async toSet() {
    const s = new TkSet();
    for await (const v of this) s._s.add(v);
    return new ImmutableSet([...s._s]);
  }
  async toMutableSet() {
    const s = new TkSet();
    for await (const v of this) s._s.add(v);
    return s;
  }
  async sorted() {
    return (await this.toMutableList()).sorted();
  }
  async sortedDescending() {
    return (await this.toMutableList()).sortedDescending();
  }
  async sortedBy(fn) {
    return (await this.toMutableList()).sortedBy(fn);
  }
  async sortedByDescending(fn) {
    return (await this.toMutableList()).sortedByDescending(fn);
  }
  async sortedWith(cmp) {
    return (await this.toMutableList()).sortedWith(cmp);
  }
}

function walkDirectory(dir) {
  function* walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) yield* walk(p);
      else yield { path: p, isFile: () => true, isDirectory: () => false };
    }
  }
  return new Sequence(() => walk(dir));
}

// ─── Range ────────────────────────────────────────────────────────────────────
class Range {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }
  [Symbol.iterator]() {
    let i = this.from;
    const to = this.to;
    return {
      next() {
        return i <= to ? { value: i++, done: false } : { value: undefined, done: true };
      },
    };
  }
}

// ─── createGlobalEnvironment ──────────────────────────────────────────────────
function createGlobalEnvironment() {
  const e = new Environment();

  // ── Core builtins ──
  e.define("println", (...a) => console.log(...a.map(tkStr)));
  e.define("listOf", (...a) => new ImmutableList(a));
  e.define(
    "isList",
    (x) => x instanceof ArrayList || x instanceof ImmutableList,
  );
  e.define("isSet", (x) => x instanceof TkSet || x instanceof ImmutableSet);
  e.define("isMap", (x) => x instanceof TkMap || x instanceof ImmutableMap);
  e.define("mutableListOf", (...a) => new ArrayList(a));
  e.define("setOf", (...a) => new ImmutableSet(a));
  e.define("mutableSetOf", (...a) => new TkSet(a));
  e.define("mapOf", (...pairs) => {
    const m = new ImmutableMap();
    for (const [k, v] of pairs) m._m.set(k, v);
    return m;
  });
  e.define("mutableMapOf", (...pairs) => {
    const m = new TkMap();
    for (const [k, v] of pairs) m.put(k, v);
    return m;
  });
  e.define("numCmp", (a, b) => a - b);
  e.define("strCmp", (a, b) => (a < b ? -1 : a > b ? 1 : 0));
  e.define("sha256", (i) =>
    require("crypto").createHash("sha256").update(String(i)).digest("hex"),
  );
  e.define("jsonParse", JSON.parse);
  e.define("jsonStringify", (obj, pretty) => JSON.stringify(obj, null, pretty ? 2 : 0));
  e.define("base64Encode", (s) => Buffer.from(s).toString("base64"));
  e.define("base64Decode", (s) => Buffer.from(s, "base64").toString());
  e.define("now", () => Date.now());
  e.define("sleep", (ms) => new Promise((r) => setTimeout(r, ms)));
  e.define("formatTime", (t) => new Date(t).toISOString());
  e.define("abs", Math.abs);
  e.define("floor", Math.floor);
  e.define("ceil", Math.ceil);
  e.define("round", Math.round);
  e.define("sqrt", Math.sqrt);
  e.define("pow", Math.pow);
  e.define("log", Math.log);
  e.define("max", Math.max);
  e.define("min", Math.min);
  e.define("random", Math.random);
  e.define("toInt", Math.trunc);
  e.define("PI", Math.PI);

  e.define("Pair", (key, value) => {
    const proto = {
      toString: function() { return `Pair(key=${tkStr(this.key)}, value=${tkStr(this.value)})`; }
    };
    const o = Object.create(proto);
    o.key = key; o.value = value;
    return o;
  });

  const _alMeta = {
    defineMethod(n, fn) {
      ArrayList.prototype[n] = function (...a) {
        return fn(this, ...a);
      };
      return _alMeta;
    },
  };
  e.define("ArrayList", _alMeta);

  const _seqMeta = {
    defineMethod(n, fn) {
      Sequence.prototype[n] = function (...a) {
        return fn(this, ...a);
      };
      return _seqMeta;
    },
  };
  e.define("Sequence", _seqMeta);

  e.define("importNpm", (pkg) => {
    const allowed = ["lodash", "axios", "dayjs", "uuid"];
    if (!allowed.includes(pkg)) throw new Error(`Package ${pkg} not allowed`);
    return require(pkg);
  });

  // Stubs for include/requireFile — need Lexer/Parser, not available in runtime
  e.define("include", () => { throw new Error("include() is not available in compiled output"); });
  e.define("requireFile", () => { throw new Error("requireFile() is not available in compiled output"); });

  // ── Collection builtins ──
  e.define("treeMap", (c) => {
    const cmp =
      typeof c === "function" ? c : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const t = new RBTree((a, b) => {
      const r = cmp(a, b);
      return r && r.then ? 0 : r;
    });
    const v = new Map();
    return {
      put(k, val) {
        if (!v.has(k)) t.insert(k);
        v.set(k, val);
        return val;
      },
      get(k) {
        return v.get(k);
      },
      remove(k) {
        if (v.delete(k)) t.remove(k);
      },
      containsKey(k) {
        return v.has(k);
      },
      size() {
        return v.size;
      },
      clear() {
        const ks = [];
        t.each((k) => ks.push(k));
        ks.forEach((k) => t.remove(k));
        v.clear();
      },
      keys() {
        const a = [];
        t.each((k) => a.push(k));
        return a;
      },
      values() {
        return this.keys().map((k) => v.get(k));
      },
      entries() {
        return this.keys().map((k) => [k, v.get(k)]);
      },
      firstKey() {
        return t.min() ?? null;
      },
      lastKey() {
        return t.max() ?? null;
      },
      floorKey(k) {
        const it = t.lowerBound(k);
        if (it && it.data() != null) {
          if (cmp(it.data(), k) === 0) return it.data();
          it.prev();
          return it.data();
        }
        return t.max() ?? null;
      },
      ceilingKey(k) {
        const it = t.lowerBound(k);
        return it ? it.data() : null;
      },
      subMap(from, to) {
        const r = [];
        let it = t.lowerBound(from);
        while (it && it.data() != null) {
          const key = it.data();
          if (cmp(key, to) >= 0) break;
          r.push([key, v.get(key)]);
          it.next();
        }
        return r;
      },
      forEach(fn) {
        t.each((k) => fn(k, v.get(k)));
      },
    };
  });

  e.define("treeMapOf", (...a) => {
    const cmp = typeof a[0] === "function" ? a.shift() : undefined;
    const m = e.lookup("treeMap")(cmp);
    for (const p of a) m.put(p[0], p[1]);
    return m;
  });

  // ── File builtins ──
  e.define("File", (fp) => {
    const full = path.resolve(fp || ".");
    const api = {
      path: full,
      exists: () => fs.existsSync(full),
      isFile: () => {
        try {
          return fs.statSync(full).isFile();
        } catch {
          return false;
        }
      },
      isDirectory: () => {
        try {
          return fs.statSync(full).isDirectory();
        } catch {
          return false;
        }
      },
      readText: (enc) => fs.readFileSync(full, enc || "utf8"),
      readLines: () => {
        const readline = require("readline");
        return new Sequence(() => {
          const stream = fs.createReadStream(full, { encoding: "utf8" });
          return readline.createInterface({
            input: stream,
            crlfDelay: Infinity,
          });
        });
      },
      tailFile: () => {
        const readline = require("readline");
        return new Sequence(async function* () {
          let pos = 0;
          try {
            pos = fs.statSync(full).size;
          } catch (e) {}

          let resolve;
          let promise = new Promise((r) => (resolve = r));
          let watcher;
          try {
            watcher = fs.watch(full, (event) => {
              if (event === "change") {
                const oldResolve = resolve;
                promise = new Promise((r) => (resolve = r));
                oldResolve();
              }
            });
          } catch (e) {
            // Watch might fail if file doesn't exist
          }

          try {
            while (true) {
              try {
                const stats = fs.statSync(full);
                if (stats.size > pos) {
                  const stream = fs.createReadStream(full, {
                    start: pos,
                    end: stats.size - 1,
                    encoding: "utf8",
                  });
                  const rl = readline.createInterface({
                    input: stream,
                    crlfDelay: Infinity,
                  });
                  for await (const line of rl) {
                    yield line;
                  }
                  pos = stats.size;
                } else if (stats.size < pos) {
                  pos = stats.size; // Reset to current end if truncated, or should we read from start?
                  // Usually tail follows the end.
                }
              } catch (e) {}
              await promise;
            }
          } finally {
            if (watcher) watcher.close();
          }
        });
      },
      writeText: (txt, enc) => {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, txt, enc || "utf8");
        return api;
      },
      appendText: (txt, enc) => {
        fs.appendFileSync(full, txt, enc || "utf8");
        return api;
      },
      readJson: (enc) => JSON.parse(fs.readFileSync(full, enc || "utf8")),
      writeJson: (o, p) => {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, JSON.stringify(o, null, p ? 2 : 0), "utf8");
        return api;
      },
      readBytes: () => fs.readFileSync(full),
      delete: () => {
        try {
          fs.rmSync(full, { recursive: true, force: true });
          return true;
        } catch {
          return false;
        }
      },
      mkdir: () => {
        fs.mkdirSync(full, { recursive: true });
        return api;
      },
      mkdirs: () => {
        fs.mkdirSync(full, { recursive: true });
        return api;
      },
      copyTo: (dest) => {
        const dp = path.resolve(dest);
        fs.mkdirSync(path.dirname(dp), { recursive: true });
        fs.copyFileSync(full, dp);
        return e.lookup("File")(dp);
      },
      moveTo: (dest) => {
        const dp = path.resolve(dest);
        fs.mkdirSync(path.dirname(dp), { recursive: true });
        fs.renameSync(full, dp);
        return e.lookup("File")(dp);
      },
      list: () => {
        try {
          return new ArrayList(
            fs
              .readdirSync(full, { withFileTypes: true })
              .map((ent) => e.lookup("File")(path.join(full, ent.name))),
          );
        } catch {
          return new ArrayList();
        }
      },
      listFiles: () => api.list(),
      walkTopDown: () => walkDirectory(full),
      size: () => {
        try {
          return fs.statSync(full).size;
        } catch {
          return 0;
        }
      },
      watch: (cb) => {
        try {
          const w = fs.watch(full, { recursive: true }, (et, fn) =>
            cb({ event: et, file: fn, path: path.join(full, fn || "") }),
          );
          return { close: () => w.close() };
        } catch {
          return null;
        }
      },
      lastModified: () => {
        try {
          return fs.statSync(full).mtimeMs;
        } catch {
          return 0;
        }
      },
      toString: () => full,
    };
    return api;
  });

  e.define("exec", (cmd) => {
    const { spawn } = require("child_process");
    const parts = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const [bin, ...args] = parts.map((p) => p.replace(/^["']|["']$/g, ""));

    let stdout = "", stderr = "";

    const proc = spawn(bin, args, { stdio: ["inherit", "pipe", "pipe"] });
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    const done = new Promise((resolve) => {
      proc.on("close", (code) => resolve({ stdout, stderr, code }));
    });

    return {
      pid: proc.pid,
      kill: (sig = "SIGINT") => proc.kill(sig),
      killForcefully: () => proc.kill("SIGKILL"),
      wait: () => done,
    };
  });

  e.define("spawn", (c, a) => spawn(c, a || [], { stdio: "inherit" }));
  e.define("env", (k) => process.env[k]);
  e.define("setEnv", (k, v) => {
    process.env[k] = v;
  });

  // ── Network builtins ──
  e.define("httpGet", async (u, h) => {
    try {
      if (h instanceof TkMap) h = Object.fromEntries(h._m);
      const r = await fetch(u, { headers: h || {} });
      return await r.text();
    } catch (ex) {
      console.error("httpGet error:", ex);
      return "";
    }
  });

  e.define("httpPost", async (u, b, h) => {
    try {
      if (h instanceof TkMap) h = Object.fromEntries(h._m);
      const r = await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(h || {}) },
        body: typeof b === "string" ? b : JSON.stringify(b),
      });
      return await r.text();
    } catch (ex) {
      console.error("httpPost error:", ex);
      return "";
    }
  });

  e.define("download", async (u, fp) => {
    try {
      const r = await fetch(u);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, Buffer.from(await r.arrayBuffer()));
      return true;
    } catch {
      return false;
    }
  });

  e.define("HttpServer", (port) => {
    const http = require("http");
    const routes = []; // [{method, re, keys, handler}]
    const middlewares = []; // [async (ctx, next) => void]

    function compilePath(p) {
      const keys = [];
      const src = p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => {
        keys.push(k);
        return "([^/?]+)";
      });
      return { re: new RegExp("^" + src + "$"), keys };
    }

    function matchRoute(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = pathname.match(r.re);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => {
            params[k] = m[i + 1];
          });
          return { handler: r.handler, params };
        }
      }
      return null;
    }

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      const match = matchRoute(req.method, url.pathname);
      if (!match) {
        res.writeHead(404);
        return res.end("not found");
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        let pb = body;
        try {
          pb = JSON.parse(body);
        } catch { }
        const ctx = {
          req,
          res,
          body: pb,
          params: new TkMap(Object.entries(match.params)),
          query: new TkMap([...url.searchParams.entries()]),
          path: url.pathname,
          method: req.method,
          _status: 200,
          _headers: {},
          status(c) {
            this._status = c;
            return this;
          },
          header(k, v) {
            this._headers[k] = v;
            return this;
          },
          text(txt) {
            res.writeHead(this._status, {
              "Content-Type": "text/plain",
              ...this._headers,
            });
            res.end(String(txt));
          },
          html(content) {
            res.writeHead(this._status, {
              "Content-Type": "text/html; charset=utf-8",
              ...this._headers,
            });
            res.end(String(content));
          },
          json(o) {
            if (o instanceof TkMap) o = Object.fromEntries(o._m);
            else if (o instanceof Map) o = Object.fromEntries(o);
            res.writeHead(this._status, {
              "Content-Type": "application/json",
              ...this._headers,
            });
            res.end(JSON.stringify(o));
          },
        };
        let i = 0;
        const next = async () => {
          if (i < middlewares.length) await middlewares[i++](ctx, next);
          else await match.handler(ctx);
        };
        try {
          await next();
        } catch (ex) {
          if (!res.writableEnded) {
            res.writeHead(500);
            res.end(String(ex));
          }
        }
      });
    });

    const addRoute = (method, p, h) => {
      const { re, keys } = compilePath(p);
      routes.push({ method, re, keys, handler: h });
    };
    return {
      use: (fn) => middlewares.push(fn),
      get: (p, h) => addRoute("GET", p, h),
      post: (p, h) => addRoute("POST", p, h),
      put: (p, h) => addRoute("PUT", p, h),
      patch: (p, h) => addRoute("PATCH", p, h),
      delete: (p, h) => addRoute("DELETE", p, h),
      start: () =>
        server.listen(port, () =>
          console.log("Server listening on :" + port),
        ),
      stop: () => new Promise((r) => server.close(r)),
    };
  });

  // ── Concurrency builtins ──
  e.define("go", (fn) =>
    setImmediate(async () => {
      try {
        await fn();
      } catch (ex) {
        console.error(ex);
      }
    }),
  );

  e.define("chan", (buf = Infinity) => {
    const q = [],
      w = [];
    let closed = false;
    return {
      send(v) {
        if (closed) throw new RuntimeError("send on closed channel");
        w.length ? w.shift()(v) : q.push(v);
      },
      receive() {
        if (q.length) return Promise.resolve(q.shift());
        if (closed) return Promise.resolve(null);
        return new Promise((r) => w.push(r));
      },
      close() {
        closed = true;
        w.splice(0).forEach((r) => r(null));
      },
    };
  });

  e.define("waitGroup", () => {
    let c = 0,
      w = [];
    return {
      add: (n) => {
        c += n;
      },
      done: () => {
        if (--c === 0) w.splice(0).forEach((f) => f());
      },
      wait: () =>
        c === 0 ? Promise.resolve() : new Promise((r) => w.push(r)),
    };
  });

  return e;
}

module.exports = {
  RuntimeError,
  Environment,
  TkMap, ImmutableMap,
  tkStr,
  ArrayList, ImmutableList,
  TkSet, ImmutableSet,
  Sequence,
  Range,
  walkDirectory,
  createGlobalEnvironment,
};
