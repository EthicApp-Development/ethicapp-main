const esbuild = require("esbuild");

const isProduction = process.argv.includes("--production");

esbuild.build({
    entryPoints: ["public/js/entrypoints/auth.js"],
    bundle:      true,
    outfile:     "public/js/auth.bundle.js",
    platform:    "browser",
    format:      "iife",
    sourcemap:   isProduction ? false : true,
    minify:      isProduction,
    target:      ["es2017"],
    logLevel:    "info",
    loader:      {
        ".js": "js"
    }
}).catch(() => process.exit(1));