# Teak

A Kotlin-inspired scripting language that runs on Node.js. Write `.tk` scripts and run them directly, or compile them to JavaScript.

**Documentation:** [teak-lang.aawadia.dev](https://teak-lang.aawadia.dev)

## Install

```bash
npm i @teaklang/teak
```

Or run directly with npx:

```bash
npx @teaklang/teak your-script.tk
```

## Quick Start

Write a Teak script:

```teak
// hello.tk
println("Hello from Teak!")

val nums = listOf(1, 2, 3, 4, 5)
val doubled = nums.map { it * 2 }
println(doubled)
```

Run it:

```bash
teak hello.tk
```

Compile it to JavaScript:

```bash
teakc hello.tk > hello.js
node hello.js
```

## Language Basics

### Variables

```teak
val name = "teak"    // immutable
var count = 0        // mutable
count += 1
```

### Functions

```teak
fun add(a, b) = a + b

fun greet(name = "Guest") = "Hello, $name!"

println(greet())      // Hello, Guest!
println(greet("Ada")) // Hello, Ada!
```

### Data Classes

```teak
data class Point(x, y)

fun (p Point) distanceTo(other) =
  sqrt((p.x - other.x) * (p.x - other.x) +
       (p.y - other.y) * (p.y - other.y))

val a = Point(0, 0)
val b = Point(3, 4)
println(a.distanceTo(b))  // 5
```

### Control Flow

```teak
val max = if (a > b) a else b

when (code) {
  200      -> println("OK")
  404      -> println("Not found")
  else     -> println("Unknown")
}

for (i in 1..10) println(i)

var i = 0
while (i < 5) {
  i += 1
}
```

### Collections

```teak
val nums = mutableListOf(3, 1, 4, 1, 5)

nums.add(9)
println(nums.sorted())          // [1, 1, 3, 4, 5, 9]
println(nums.filter { it > 3 }) // [4, 5, 9]
println(nums.fold(0) { acc, v -> acc + v })

val counts = listOf("a", "b", "a").groupBy { it }
println(counts)  // {a: [a, a], b: [b]}
```

### HTTP Server

```teak
val server = HttpServer(3000)

server.get("/") {
  it.html("<h1>Hello from Teak!</h1>")
}

server.get("/users/:id") {
  val id = it.params.get("id")
  it.json(mutableMapOf("userId" to id))
}

server.post("/users") {
  it.status(201).json(mutableMapOf("created" to it.body.name))
}

server.start()
```

### File Processing

```teak
File("server.log").readLines()
  .filter { it.includes("ERROR") }
  .take(20)
  .forEach { println(it) }
```

## Commands

| Command           | Description                         |
| ----------------- | ----------------------------------- |
| `teak <file.tk>`  | Run a Teak script                   |
| `teakc <file.tk>` | Compile a Teak script to JavaScript |

## Examples

See the [`examples/`](examples/) directory for comprehensive, runnable examples of every language feature:

| File                        | What it covers                                                |
| --------------------------- | ------------------------------------------------------------- |
| `01-hello-world.tk`         | The basics — `println` and comments                           |
| `02-variables-and-types.tk` | `val`/`var`, immutability, types                              |
| `03-functions.tk`           | Functions, lambdas, default params, recursion                 |
| `04-control-flow.tk`        | `if`/`else`, `when`, `for`-`in`, `while`, `break`, `continue` |
| `05-strings.tk`             | Interpolation, string methods, triple-quoted strings          |
| `06-data-classes.tk`        | Data classes, default fields, receiver functions              |
| `07-lists.tk`               | Immutable/mutable lists, functional ops, slicing, sorting     |
| `08-sets.tk`                | Sets, set operations (union, intersect, subtract)             |
| `09-maps.tk`                | Maps, `to` operator, functional ops                           |
| `10-sequences.tk`           | Lazy sequences, pipeline operations                           |
| `11-file-io.tk`             | File read/write/append/copy/delete, directory ops, JSON       |
| `12-http-server.tk`         | HTTP server with routing, middleware, path/query params       |
| `13-concurrency.tk`         | `go {}`, channels, wait groups                                |
| `14-recursion.tk`           | Recursive algorithms — sum, tree leaves, quicksort, GCD       |

Run any example with:

```bash
teak examples/03-functions.tk
```

## License

[MIT](LICENSE)
