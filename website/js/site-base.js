/**
 * Insert <base> at the static site root (the folder that contains css/, js/, index.html) so every
 * URL after the first script resolves the same on:
 * - GitHub Pages: .../<repo>/website/src/pages/*.html
 * - Local: http://127.0.0.1:5173/src/pages/*.html (npm start from website/)
 *
 * The first script tag must keep a path relative to the *document* (../../js/site-base.js) because
 * <base> does not exist until this file runs.
 */
(function () {
  var path = location.pathname.replace(/\\/g, "/");
  var origin = location.origin;

  function setBase(href) {
    var b = document.createElement("base");
    b.href = href;
    var head = document.head;
    if (head.firstChild) head.insertBefore(b, head.firstChild);
    else head.appendChild(b);
  }

  var key = "/website/";
  var i = path.indexOf(key);
  if (i !== -1) {
    setBase(origin + path.slice(0, i + key.length));
    return;
  }

  var marker = "/src/pages/";
  var j = path.indexOf(marker);
  if (j !== -1) {
    var rootPath = path.slice(0, j);
    if (!rootPath.endsWith("/")) rootPath += "/";
    setBase(origin + rootPath);
  }
})();
