function renderScripts(scripts, res) {
    const isProduction = process.env.NODE_ENV === "production";
    return scripts.map(script => {
        const assetPath = script.length > 1 && isProduction ? script[1] : script[0];
        return `<script src="${res.locals.asset(assetPath)}" defer></script>`;
    }).join("\n");
}

export { renderScripts };
