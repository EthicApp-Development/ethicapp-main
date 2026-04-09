const esbuild = require("esbuild");

async function start() {
    const context = await esbuild.context({
        entryPoints: ["public/js/entrypoints/auth.js"],
        bundle:      true,
        outfile:     "public/js/auth.bundle.js",
        platform:    "browser",
        format:      "iife",
        sourcemap:   true,
        minify:      false,
        target:      ["es2017"],
        logLevel:    "info",
        loader:      {
            ".js": "js"
        }
    });

    await context.watch();
    console.log("Watching auth bundle...");
}

start().catch((error) => {
    console.error(error);
    process.exit(1);
});