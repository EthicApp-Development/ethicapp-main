function renderScripts(scripts, res) {
    const isProduction = process.env.NODE_ENV === "production";

    console.log("res.locals.asset: " + res.locals.asset);

    return scripts.map(script => {
        const assetPath = script.length > 1 && isProduction ? script[1] : script[0];
        return `<script src="${res.locals.asset(assetPath)}" defer></script>`;
    }).join("\n");
}

export { renderScripts };
