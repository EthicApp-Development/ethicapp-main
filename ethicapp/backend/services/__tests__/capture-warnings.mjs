// Runs fn and returns its result together with the console.warn() calls it made.
export function captureWarnings(fn) {
    const warnings     = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(" ")); };
    return Promise.resolve()
        .then(fn)
        .then(result => ({ result, warnings }))
        .finally(() => { console.warn = originalWarn; });
}
