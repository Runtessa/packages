"use strict";
const moduleApi = require("node:module");
const patched = Symbol.for('runtessa.glob-budget');
const guarded = new WeakMap();
function inspectPattern(value) {
    if (typeof value === 'string') {
        if (value.length > 65536)
            throw new Error('Glob pattern exceeds the input budget');
        let depth = 0, escaped = false;
        for (const character of value) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (character === '\\') {
                escaped = true;
                continue;
            }
            if (character === '{' && ++depth > 128)
                throw new Error('Glob nesting exceeds the parsing budget');
            if (character === '}')
                depth = Math.max(0, depth - 1);
        }
    }
    else if (value && typeof value === 'object') {
        const pending = [{ node: value, depth: 0 }], seen = new WeakSet();
        let count = 0;
        while (pending.length) {
            const { node, depth } = pending.pop();
            if (!node || typeof node !== 'object')
                continue;
            if (depth > 128 || ++count > 10000 || seen.has(node))
                throw new Error('Glob syntax tree exceeds the parsing budget');
            seen.add(node);
            if (Array.isArray(node))
                for (const child of node)
                    pending.push({ node: child, depth: depth + 1 });
            else if (Array.isArray(node.nodes))
                for (const child of node.nodes)
                    pending.push({ node: child, depth: depth + 1 });
        }
    }
}
function wrap(value) {
    if (typeof value !== 'function')
        return value;
    if (guarded.has(value))
        return guarded.get(value);
    const proxy = new Proxy(value, {
        apply(target, receiver, args) { inspectPattern(args[0]); return Reflect.apply(target, receiver, args); },
        get(target, key, receiver) {
            const property = Reflect.get(target, key, receiver);
            return ['parse', 'compile', 'expand', 'stringify', 'create'].includes(String(key)) ? wrap(property) : property;
        },
    });
    guarded.set(value, proxy);
    return proxy;
}
function formattingBudget(pattern) {
    if (typeof pattern !== 'string' || pattern.length > 65536)
        throw new Error('Format exceeds the input budget');
    const fields = pattern.match(/%[^%]{0,100}/g) || [];
    if (fields.length > 128 || fields.some((field) => [...field.matchAll(/\d+/g)].some((match) => Number(match[0]) > 10000)))
        throw new Error('Format precision or width exceeds the output budget');
}
function boundedFormatting(value) {
    if (!value || typeof value !== 'object')
        return value;
    return new Proxy(value, { get(target, key, receiver) {
            const method = Reflect.get(target, key, receiver);
            if (!['sprintf', 'vsprintf'].includes(String(key)))
                return method;
            return new Proxy(method, { apply(fn, context, args) { formattingBudget(args[0]); return Reflect.apply(fn, context, args); } });
        } });
}
// Upstream has not published a patch for GHSA-vfj7-8cjw-p6xm. Bound inputs at
// the module boundary rather than modifying dependency files or hiding the advisory.
if (!moduleApi[patched]) {
    moduleApi[patched] = true;
    const original = moduleApi._load;
    moduleApi._load = function (request, parent, main) {
        const value = original.call(this, request, parent, main);
        if (request === 'sprintf-js')
            return boundedFormatting(value);
        if (request === 'braces' || request.startsWith('braces/') || parent?.filename?.includes('/node_modules/braces/')) {
            const filename = moduleApi._resolveFilename(request, parent);
            if (/\/node_modules\/braces\/(?:index|lib\/(?:parse|compile|expand|stringify))\.js$/.test(filename))
                return wrap(value);
        }
        return value;
    };
}
