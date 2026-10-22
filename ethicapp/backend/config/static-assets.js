import express from "express";
import path from "path";

const FONT_EXTENSIONS = [".woff", ".woff2", ".ttf", ".eot", ".otf", ".svg"];
const IMAGE_EXTENSIONS = [".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"];

// The only parts of frontend/assets the teacher UI loads, and the file types
// each may serve. Everything else (package files, raw sources, uploads left
// in the tree, dotfiles) stays private. Source maps are added outside
// production only (#187).
export const PUBLIC_ASSET_DIRECTORIES = [
    // assets-bundle.css @imports the sibling stylesheets at runtime.
    { directory: "css", extensions: [".css"], sourceMaps: true },
    { directory: "js/dist", extensions: [".js"], sourceMaps: true },
    { directory: "images", extensions: IMAGE_EXTENSIONS },
    { directory: "static/views", extensions: [".html"] },
    { directory: "locales", extensions: [".json"] },
    { directory: "fontawesome", extensions: [".css", ...FONT_EXTENSIONS] },
    { directory: "webfonts", extensions: FONT_EXTENSIONS },
];

const STATIC_OPTIONS = {
    dotfiles:    "ignore",
    index:       false,
    redirect:    false,
    fallthrough: true,
};

function serveExtensions(root, extensions) {
    const allowed = new Set(extensions);
    const serve = express.static(root, STATIC_OPTIONS);

    return (req, res, next) => {
        if (!allowed.has(path.extname(req.path).toLowerCase())) {
            return next();
        }
        return serve(req, res, next);
    };
}

/**
 * Mounts the public asset directories under /assets, plus /static/views for
 * the teacher route templates, which teacher-routes.js loads with paths
 * relative to /home.
 * @param {import("express").Express} app
 * @param {string} assetsRoot absolute path of frontend/assets
 * @param {{ sourceMaps?: boolean }} [options] serve .map files; defaults to
 *   true outside production
 */
export function mountStaticAssets(app, assetsRoot,
    { sourceMaps = process.env.NODE_ENV !== "production" } = {}) {
    for (const { directory, extensions, sourceMaps: hasMaps } of PUBLIC_ASSET_DIRECTORIES) {
        const allowed = sourceMaps && hasMaps ? [...extensions, ".map"] : extensions;
        app.use(`/assets/${directory}`, serveExtensions(path.join(assetsRoot, directory), allowed));
    }

    app.use("/static/views", serveExtensions(path.join(assetsRoot, "static/views"), [".html"]));
}
