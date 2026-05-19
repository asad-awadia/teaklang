const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const builtins = [
    { name: 'println', args: '(...args)', doc: 'Prints given arguments to the standard output.' },
    { name: 'listOf', args: '(...elements)', doc: 'Creates an immutable list.' },
    { name: 'mutableListOf', args: '(...elements)', doc: 'Creates a mutable list.' },
    { name: 'setOf', args: '(...elements)', doc: 'Creates an immutable set.' },
    { name: 'mutableSetOf', args: '(...elements)', doc: 'Creates a mutable set.' },
    { name: 'mapOf', args: '(...pairs)', doc: 'Creates an immutable map from pairs.' },
    { name: 'mutableMapOf', args: '(...pairs)', doc: 'Creates a mutable map from pairs.' },
    { name: 'Pair', args: '(key, value)', doc: 'Creates a key-value pair.' },
    { name: 'isList', args: '(obj)', doc: 'Checks if an object is a list.' },
    { name: 'isSet', args: '(obj)', doc: 'Checks if an object is a set.' },
    { name: 'isMap', args: '(obj)', doc: 'Checks if an object is a map.' },
    { name: 'treeMap', args: '(comparator?)', doc: 'Creates a TreeMap.' },
    { name: 'treeMapOf', args: '(comparator?, ...pairs)', doc: 'Creates a TreeMap with pairs.' },
    { name: 'numCmp', args: '(a, b)', doc: 'Numeric comparison.' },
    { name: 'strCmp', args: '(a, b)', doc: 'String comparison.' },
    { name: 'sha256', args: '(input)', doc: 'Calculates SHA-256 hash.' },
    { name: 'jsonParse', args: '(str)', doc: 'Parses a JSON string.' },
    { name: 'jsonStringify', args: '(obj, pretty?)', doc: 'Stringifies an object to JSON.' },
    { name: 'base64Encode', args: '(str)', doc: 'Encodes a string to Base64.' },
    { name: 'base64Decode', args: '(str)', doc: 'Decodes a Base64 string.' },
    { name: 'now', args: '()', doc: 'Returns the current timestamp in milliseconds.' },
    { name: 'sleep', args: '(ms)', doc: 'Sleeps for the given milliseconds.' },
    { name: 'formatTime', args: '(timestamp)', doc: 'Formats a timestamp.' },
    { name: 'abs', args: '(num)', doc: 'Absolute value.' },
    { name: 'floor', args: '(num)', doc: 'Floor value.' },
    { name: 'ceil', args: '(num)', doc: 'Ceil value.' },
    { name: 'round', args: '(num)', doc: 'Round value.' },
    { name: 'sqrt', args: '(num)', doc: 'Square root.' },
    { name: 'pow', args: '(base, exp)', doc: 'Power.' },
    { name: 'log', args: '(num)', doc: 'Natural logarithm.' },
    { name: 'max', args: '(a, b)', doc: 'Maximum of two numbers.' },
    { name: 'min', args: '(a, b)', doc: 'Minimum of two numbers.' },
    { name: 'random', args: '()', doc: 'Random float between 0 and 1.' },
    { name: 'toInt', args: '(num)', doc: 'Truncates to integer.' },
    { name: 'PI', args: '', doc: 'Pi constant.', isProp: true },
    { name: 'File', args: '(path)', doc: 'Creates a File object.' },
    { name: 'exec', args: '(cmd)', doc: 'Executes a command.' },
    { name: 'spawn', args: '(cmd, args)', doc: 'Spawns a command.' },
    { name: 'env', args: '(key)', doc: 'Gets an environment variable.' },
    { name: 'setEnv', args: '(key, value)', doc: 'Sets an environment variable.' },
    { name: 'httpGet', args: '(url, headers?)', doc: 'Performs an HTTP GET request.' },
    { name: 'httpPost', args: '(url, body, headers?)', doc: 'Performs an HTTP POST request.' },
    { name: 'download', args: '(url, file_path)', doc: 'Downloads a URL to a file.' },
    { name: 'HttpServer', args: '(port)', doc: 'Creates an HTTP server.' },
    { name: 'go', args: '(fn)', doc: 'Starts a goroutine-style block.' },
    { name: 'chan', args: '(buffer?)', doc: 'Creates a channel.' },
    { name: 'waitGroup', args: '()', doc: 'Creates a WaitGroup.' },
    { name: 'importNpm', args: '(pkg)', doc: 'Imports an allowed NPM package.' },
    { name: 'include', args: '(file_path)', doc: 'Includes a Teak source file.' },
    { name: 'requireFile', args: '(file_path)', doc: 'Requires a Teak source file.' },
    { name: 'ArrayList', args: '()', doc: 'ArrayList class.' },
    { name: 'Sequence', args: '()', doc: 'Sequence class.' },
    { name: 'walkDirectory', args: '(dir)', doc: 'Walks a directory and returns a Sequence.' }
];

const keywords = [
    'data', 'class', 'fun', 'val', 'var', 'if', 'else', 'when', 
    'for', 'in', 'while', 'return', 'break', 'continue', 'true', 'false', 'null'
];

const listMethods = [
    { name: 'add', args: '(x)', doc: 'Adds an element.' },
    { name: 'addAll', args: '(xs)', doc: 'Adds all elements.' },
    { name: 'set', args: '(i, v)', doc: 'Sets element at index.' },
    { name: 'remove', args: '(x)', doc: 'Removes an element.' },
    { name: 'removeAt', args: '(i)', doc: 'Removes element at index.' },
    { name: 'clear', args: '()', doc: 'Clears the list.' },
    { name: 'sort', args: '(fn?)', doc: 'Sorts the list.' },
    { name: 'get', args: '(i)', doc: 'Gets element at index.' },
    { name: 'size', args: '()', doc: 'Gets the size.' },
    { name: 'isEmpty', args: '()', doc: 'Checks if empty.' },
    { name: 'contains', args: '(x)', doc: 'Checks if contains element.' },
    { name: 'indexOf', args: '(x)', doc: 'Finds index of element.' },
    { name: 'lastIndexOf', args: '(x)', doc: 'Finds last index of element.' },
    { name: 'first', args: '(p?)', doc: 'Finds first element.' },
    { name: 'last', args: '(p?)', doc: 'Finds last element.' },
    { name: 'head', args: '()', doc: 'Gets the first element.' },
    { name: 'take', args: '(n)', doc: 'Takes first n elements.' },
    { name: 'drop', args: '(n)', doc: 'Drops first n elements.' },
    { name: 'rest', args: '()', doc: 'Returns elements after the first.' },
    { name: 'reversed', args: '()', doc: 'Returns reversed list.' },
    { name: 'chunked', args: '(n)', doc: 'Chunks list into sublists of size n.' },
    { name: 'windowed', args: '(n, step?)', doc: 'Returns sliding windows.' },
    { name: 'zip', args: '(other)', doc: 'Zips two lists.' },
    { name: 'sorted', args: '()', doc: 'Returns sorted list.' },
    { name: 'sortedDescending', args: '()', doc: 'Returns sorted list descending.' },
    { name: 'sortedBy', args: '(fn)', doc: 'Returns sorted list by function.' },
    { name: 'sortedByDescending', args: '(fn)', doc: 'Returns sorted list descending by function.' },
    { name: 'sortedWith', args: '(cmp)', doc: 'Returns sorted list with comparator.' },
    { name: 'distinct', args: '()', doc: 'Returns distinct elements.' },
    { name: 'distinctBy', args: '(fn)', doc: 'Returns distinct elements by function.' },
    { name: 'filter', args: '(p)', doc: 'Filters elements.' },
    { name: 'filterNot', args: '(p)', doc: 'Filters elements out.' },
    { name: 'filterNotNull', args: '()', doc: 'Filters non-null elements.' },
    { name: 'takeWhile', args: '(p)', doc: 'Takes elements while predicate is true.' },
    { name: 'dropWhile', args: '(p)', doc: 'Drops elements while predicate is true.' },
    { name: 'any', args: '(p?)', doc: 'Checks if any element matches predicate.' },
    { name: 'all', args: '(p?)', doc: 'Checks if all elements match predicate.' },
    { name: 'none', args: '(p?)', doc: 'Checks if no element matches predicate.' },
    { name: 'find', args: '(p)', doc: 'Finds an element matching predicate.' },
    { name: 'forEach', args: '(f)', doc: 'Iterates elements.' },
    { name: 'forEachIndexed', args: '(f)', doc: 'Iterates elements with index.' },
    { name: 'onEach', args: '(f)', doc: 'Iterates elements and returns list.' },
    { name: 'map', args: '(f)', doc: 'Maps elements.' },
    { name: 'mapIndexed', args: '(f)', doc: 'Maps elements with index.' },
    { name: 'mapNotNull', args: '(f)', doc: 'Maps to non-null elements.' },
    { name: 'flatMap', args: '(f)', doc: 'Flat maps elements.' },
    { name: 'flatten', args: '()', doc: 'Flattens nested lists.' },
    { name: 'reduce', args: '(f, init?)', doc: 'Reduces elements.' },
    { name: 'fold', args: '(init, f)', doc: 'Folds elements.' },
    { name: 'sum', args: '()', doc: 'Sums elements.' },
    { name: 'sumOf', args: '(f)', doc: 'Sums mapped elements.' },
    { name: 'average', args: '()', doc: 'Averages elements.' },
    { name: 'count', args: '(p?)', doc: 'Counts elements.' },
    { name: 'maxOrNull', args: '()', doc: 'Finds max element.' },
    { name: 'minOrNull', args: '()', doc: 'Finds min element.' },
    { name: 'maxByOrNull', args: '(f)', doc: 'Finds max element by function.' },
    { name: 'minByOrNull', args: '(f)', doc: 'Finds min element by function.' },
    { name: 'groupBy', args: '(f)', doc: 'Groups elements.' },
    { name: 'associate', args: '(f)', doc: 'Associates elements.' },
    { name: 'associateBy', args: '(f)', doc: 'Associates elements by key.' },
    { name: 'partition', args: '(p)', doc: 'Partitions elements.' },
    { name: 'joinToString', args: '(sep?, prefix?, postfix?)', doc: 'Joins elements to a string.' },
    { name: 'toList', args: '()', doc: 'Returns an immutable list.' },
    { name: 'toMutableList', args: '()', doc: 'Returns a mutable list.' },
    { name: 'toSet', args: '()', doc: 'Returns a set.' },
    { name: 'toMutableSet', args: '()', doc: 'Returns a mutable set.' },
    { name: 'toMap', args: '()', doc: 'Returns a map.' },
    { name: 'toSequence', args: '()', doc: 'Returns a sequence.' },
    { name: 'asSequence', args: '()', doc: 'Returns a sequence.' }
];

const mapMethods = [
    { name: 'get', args: '(k)', doc: 'Gets a value.' },
    { name: 'put', args: '(k, v)', doc: 'Puts a value.' },
    { name: 'set', args: '(k, v)', doc: 'Sets a value.' },
    { name: 'remove', args: '(k)', doc: 'Removes a value.' },
    { name: 'containsKey', args: '(k)', doc: 'Checks if map contains key.' },
    { name: 'containsValue', args: '(v)', doc: 'Checks if map contains value.' },
    { name: 'keys', args: '()', doc: 'Gets keys.' },
    { name: 'values', args: '()', doc: 'Gets values.' },
    { name: 'entries', args: '()', doc: 'Gets entries.' },
    { name: 'size', args: '()', doc: 'Gets the size.' },
    { name: 'isEmpty', args: '()', doc: 'Checks if empty.' },
    { name: 'forEach', args: '(fn)', doc: 'Iterates entries.' },
    { name: 'mapValues', args: '(fn)', doc: 'Maps values.' },
    { name: 'mapKeys', args: '(fn)', doc: 'Maps keys.' },
    { name: 'map', args: '(fn)', doc: 'Maps entries.' },
    { name: 'filter', args: '(fn)', doc: 'Filters entries.' },
    { name: 'filterNot', args: '(fn)', doc: 'Filters entries out.' },
    { name: 'any', args: '(fn?)', doc: 'Checks if any entry matches predicate.' },
    { name: 'all', args: '(fn?)', doc: 'Checks if all entries match predicate.' },
    { name: 'none', args: '(fn?)', doc: 'Checks if no entry matches predicate.' },
    { name: 'find', args: '(fn)', doc: 'Finds an entry.' },
    { name: 'count', args: '(fn?)', doc: 'Counts entries.' },
    { name: 'toMap', args: '()', doc: 'Returns an immutable map.' },
    { name: 'toMutableMap', args: '()', doc: 'Returns a mutable map.' }
];

const fileMethods = [
    { name: 'exists', args: '()', doc: 'Checks if file exists.' },
    { name: 'isFile', args: '()', doc: 'Checks if it is a file.' },
    { name: 'isDirectory', args: '()', doc: 'Checks if it is a directory.' },
    { name: 'readText', args: '(enc?)', doc: 'Reads text.' },
    { name: 'readLines', args: '()', doc: 'Reads lines as a Sequence.' },
    { name: 'tailFile', args: '()', doc: 'Tails file as a Sequence.' },
    { name: 'writeText', args: '(txt, enc?)', doc: 'Writes text.' },
    { name: 'appendText', args: '(txt, enc?)', doc: 'Appends text.' },
    { name: 'readJson', args: '(enc?)', doc: 'Reads JSON.' },
    { name: 'writeJson', args: '(o, p?)', doc: 'Writes JSON.' },
    { name: 'readBytes', args: '()', doc: 'Reads bytes.' },
    { name: 'delete', args: '()', doc: 'Deletes file or directory.' },
    { name: 'mkdir', args: '()', doc: 'Creates a directory.' },
    { name: 'mkdirs', args: '()', doc: 'Creates a directory recursively.' },
    { name: 'copyTo', args: '(dest)', doc: 'Copies file.' },
    { name: 'moveTo', args: '(dest)', doc: 'Moves file.' },
    { name: 'list', args: '()', doc: 'Lists files in directory.' },
    { name: 'listFiles', args: '()', doc: 'Lists files in directory.' },
    { name: 'walkTopDown', args: '()', doc: 'Walks directory top down.' },
    { name: 'size', args: '()', doc: 'Gets file size.' },
    { name: 'watch', args: '(cb)', doc: 'Watches file.' },
    { name: 'lastModified', args: '()', doc: 'Gets last modified timestamp.' }
];

function getDocumentSymbols(document) {
    const text = document.getText();
    const symbols = [];
    const fields = new Set();
    
    // Parse data classes
    const dataClassRegex = /data\s+class\s+([A-Z][a-zA-Z0-9_]*)\s*\(([^)]*)\)/g;
    let match;
    while ((match = dataClassRegex.exec(text)) !== null) {
        const name = match[1];
        const params = match[2];
        symbols.push({
            name,
            args: `(${params})`,
            doc: `Data class ${name}`,
            kind: vscode.CompletionItemKind.Class
        });
        
        // Add fields
        params.split(',').forEach(p => {
            const field = p.split('=')[0].trim();
            if (field) fields.add(field);
        });
    }

    // Parse functions
    const funRegex = /fun\s+(?:\([^)]+\)\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/g;
    while ((match = funRegex.exec(text)) !== null) {
        const name = match[1];
        const params = match[2];
        symbols.push({
            name,
            args: `(${params})`,
            doc: `User-defined function ${name}`,
            kind: vscode.CompletionItemKind.Function
        });
    }

    // Parse variables
    const varRegex = /(?:val|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    while ((match = varRegex.exec(text)) !== null) {
        symbols.push({
            name: match[1],
            args: '',
            doc: `Variable ${match[1]}`,
            kind: vscode.CompletionItemKind.Variable
        });
    }

    return { symbols, fields: Array.from(fields) };
}

function activate(context) {
    // Completion Item Provider for Built-ins & Document Symbols
    const builtinProvider = vscode.languages.registerCompletionItemProvider('teak', {
        provideCompletionItems(document, position, token, context) {
            const { symbols } = getDocumentSymbols(document);
            const items = builtins.map(b => {
                const item = new vscode.CompletionItem(b.name, b.isProp ? vscode.CompletionItemKind.Constant : vscode.CompletionItemKind.Function);
                item.detail = b.name + (b.args || '');
                item.documentation = new vscode.MarkdownString(b.doc);
                if (!b.isProp) {
                    item.insertText = new vscode.SnippetString(b.name + '($1)$0');
                }
                return item;
            });
            
            symbols.forEach(s => {
                const item = new vscode.CompletionItem(s.name, s.kind);
                item.detail = s.name + s.args;
                item.documentation = new vscode.MarkdownString(s.doc);
                if (s.kind === vscode.CompletionItemKind.Class || s.kind === vscode.CompletionItemKind.Function) {
                    item.insertText = new vscode.SnippetString(s.name + '($1)$0');
                }
                items.push(item);
            });
            
            keywords.forEach(kw => {
                items.push(new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword));
            });

            return items;
        }
    });

    // Completion Item Provider for Methods & Fields (. accessor)
    const methodProvider = vscode.languages.registerCompletionItemProvider('teak', {
        provideCompletionItems(document, position, token, context) {
            const linePrefix = document.lineAt(position).text.substr(0, position.character);
            if (!linePrefix.endsWith('.')) {
                return undefined;
            }

            const { fields } = getDocumentSymbols(document);
            const allMethods = [...new Map([...listMethods, ...mapMethods, ...fileMethods].map(item => [item.name, item])).values()];
            const items = allMethods.map(m => {
                const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Method);
                item.detail = m.name + m.args;
                item.documentation = new vscode.MarkdownString(m.doc);
                return item;
            });
            
            fields.forEach(f => {
                const item = new vscode.CompletionItem(f, vscode.CompletionItemKind.Field);
                item.detail = f;
                item.documentation = new vscode.MarkdownString(`Field ${f}`);
                items.push(item);
            });

            return items;
        }
    }, '.');

    // Hover Provider
    const hoverProvider = vscode.languages.registerHoverProvider('teak', {
        provideHover(document, position, token) {
            const range = document.getWordRangeAtPosition(position);
            if (!range) return;
            const word = document.getText(range);

            const builtin = builtins.find(b => b.name === word);
            if (builtin) {
                return new vscode.Hover(new vscode.MarkdownString(`**${builtin.name}**${builtin.args || ''}\n\n${builtin.doc}`));
            }

            const method = listMethods.find(m => m.name === word) || mapMethods.find(m => m.name === word) || fileMethods.find(m => m.name === word);
            if (method) {
                return new vscode.Hover(new vscode.MarkdownString(`**${method.name}**${method.args || ''}\n\n${method.doc}`));
            }

            const { symbols } = getDocumentSymbols(document);
            const sym = symbols.find(s => s.name === word);
            if (sym) {
                return new vscode.Hover(new vscode.MarkdownString(`**${sym.name}**${sym.args || ''}\n\n${sym.doc}`));
            }
        }
    });

    // Signature Help Provider
    const signatureProvider = vscode.languages.registerSignatureHelpProvider('teak', {
        provideSignatureHelp(document, position, token, context) {
            const linePrefix = document.lineAt(position).text.substr(0, position.character);
            const match = linePrefix.match(/([a-zA-Z0-9_]+)\s*\($/);
            if (!match) return null;

            const name = match[1];
            const builtin = builtins.find(b => b.name === name);
            const method = listMethods.find(m => m.name === name) || mapMethods.find(m => m.name === name) || fileMethods.find(m => m.name === name);
            
            let item = builtin || method;
            
            if (!item) {
                const { symbols } = getDocumentSymbols(document);
                item = symbols.find(s => s.name === name);
            }

            if (!item || !item.args) return null;

            const help = new vscode.SignatureHelp();
            help.signatures = [new vscode.SignatureInformation(`${item.name}${item.args}`, new vscode.MarkdownString(item.doc))];
            help.activeSignature = 0;
            help.activeParameter = 0;
            return help;
        }
    }, '(', ',');

    // Command to Run the Current File
    const runCmd = vscode.commands.registerCommand('teak.runFile', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const filePath = editor.document.uri.fsPath;
        const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspacePath) return;

        const terminal = vscode.window.createTerminal('Teak Runner');
        terminal.show();
        terminal.sendText(`node "${path.join(workspacePath, 'interpreter.js')}" "${filePath}"`);
    });

    // Command to Compile the Current File
    const compileCmd = vscode.commands.registerCommand('teak.compileFile', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const filePath = editor.document.uri.fsPath;
        const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspacePath) return;

        const terminal = vscode.window.createTerminal('Teak Compiler');
        terminal.show();
        terminal.sendText(`node "${path.join(workspacePath, 'compiler.js')}" "${filePath}"`);
    });

    context.subscriptions.push(builtinProvider, methodProvider, hoverProvider, signatureProvider, runCmd, compileCmd);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
