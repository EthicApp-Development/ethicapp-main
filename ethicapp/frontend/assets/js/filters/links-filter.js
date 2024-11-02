function LinksFilter() {
    var replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    var replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
    var replacePattern3 = /(\w+@[a-zA-Z_]+?\.[a-zA-Z]{2,6})/gim;

    return function (text) {
        if (text == null) return text;
        angular.forEach(text.match(replacePattern1), function () {
            text = text.replace(replacePattern1, "<a href=\"$1\" target=\"_blank\">$1</a>");
        });
        angular.forEach(text.match(replacePattern2), function () {
            text = text.replace(replacePattern2, 
                "$1<a href=\"http://$2\" target=\"_blank\">$2</a>");
        });
        angular.forEach(text.match(replacePattern3), function () {
            text = text.replace(replacePattern3, "<a href=\"mailto:$1\">$1</a>");
        });
        return text;
    };
};

export { LinksFilter };