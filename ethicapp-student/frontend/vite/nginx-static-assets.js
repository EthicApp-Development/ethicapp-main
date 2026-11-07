// Serves EthicApp's shared NGINX assets from Vite's dev and preview servers
// (#999).
//
// The logo, favicons, web app manifest and Nunito font live once, in
// nginx/static/, and NGINX serves them to the three React SPAs at root paths
// and under each SPA's base (/auth/, /student/, /mng/). Outside the stack,
// under `vite` or `vite preview`, those paths would 404. This plugin answers
// the same URL patterns from the same files, so nginx/static/ stays the single
// source. It never runs in `vite build` (apply: 'serve' covers dev and
// preview), and does nothing when nginx/static/ is not there, as inside a dev
// container that mounts only the subproject: NGINX serves the assets there.
//
// The SPAs keep identical copies of this file, at <spa>/vite/, because the
// Docker build of each SPA sees only its own directory.
// nginx/__tests__/vite-nginx-static-assets.node-test.mjs checks that the copies
// are identical and that NGINX serves each pattern from the same file.
//
// A custom middleware bypasses Vite's server.fs.allow, and the dev servers
// listen on 0.0.0.0, so the checks below are the only guard on these files:
// the path is decoded before it is checked, backslashes and NUL bytes are
// refused, and only regular files whose real path is inside one of the three
// directories are served. Every other request under these patterns gets 404.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// <repo>/<service>/frontend/vite/ -> <repo>/nginx/static
const DEFAULT_STATIC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../nginx/static'
);

const SPA_PREFIX = '(?:/(?:auth|student|mng))?';

// The URL patterns NGINX serves from nginx/static, each with the directory and
// the captured file path inside it.
export const NGINX_STATIC_ROUTES = Object.freeze([
  { directory: 'fonts', pattern: new RegExp(`^${SPA_PREFIX}/static/fonts/(.+)$`) },
  { directory: 'favicon', pattern: new RegExp(`^${SPA_PREFIX}/favicon/(.+)$`) },
  {
    directory: 'favicon',
    pattern: new RegExp(`^${SPA_PREFIX}/(favicon\\.ico|favicon\\.svg|apple-touch-icon\\.png|site\\.webmanifest)$`),
  },
  { directory: 'logos', pattern: new RegExp(`^${SPA_PREFIX}/(?:images|assets/images)/logos/(.+)$`) },
]);

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
});

/**
 * The file under `staticRoot` a request path names, `null` when the path
 * matches a pattern but names no servable file, or `undefined` when it matches
 * none. `requestPath` is the raw path, without the query string.
 */
export function resolveNginxStaticFile(staticRoot, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }

  const route = NGINX_STATIC_ROUTES.find(({ pattern }) => pattern.test(decoded));
  if (!route) {
    return undefined;
  }

  const relative = decoded.match(route.pattern)[1];
  if (relative.includes('\\') || relative.includes('\0')) {
    return null;
  }

  const directory = path.join(staticRoot, route.directory);
  const candidate = path.resolve(directory, relative);
  if (!candidate.startsWith(directory + path.sep)) {
    return null;
  }

  try {
    const realDirectory = fs.realpathSync(directory);
    const realFile = fs.realpathSync(candidate);
    if (!realFile.startsWith(realDirectory + path.sep) || !fs.statSync(realFile).isFile()) {
      return null;
    }
    return realFile;
  } catch {
    return null;
  }
}

/** A connect middleware serving `staticRoot` under NGINX_STATIC_ROUTES. */
export function createNginxStaticMiddleware(staticRoot) {
  return function nginxStaticAssets(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    const requestPath = String(req.url || '').split('?')[0];
    const file = resolveNginxStaticFile(staticRoot, requestPath);
    if (file === undefined) {
      next();
      return;
    }

    if (file === null) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(file).size);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  };
}

/** The Vite plugin. `staticRoot` defaults to the repository's nginx/static. */
export default function nginxStaticAssets({ staticRoot = DEFAULT_STATIC_ROOT } = {}) {
  function install(server) {
    if (!fs.existsSync(staticRoot)) {
      return;
    }
    // Added directly, so it runs before Vite's own middlewares and sees
    // requests outside the SPA's base.
    server.middlewares.use(createNginxStaticMiddleware(staticRoot));
  }

  return {
    name: 'ethicapp-nginx-static-assets',
    apply: 'serve',
    configureServer: install,
    configurePreviewServer: install,
  };
}
