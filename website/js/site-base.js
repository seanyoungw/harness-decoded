/**
 * GitHub Pages: site lives at /<repo>/website/... — insert <base> so same-dir links work from src/pages/*.
 * Local file:// and localhost without /website/ segment: no-op (relative paths already correct).
 */
(function () {
  var path = location.pathname;
  var key = "/website/";
  var i = path.indexOf(key);
  if (i === -1) return;
  var basePath = path.slice(0, i + key.length);
  var href = location.origin + basePath;
  var b = document.createElement("base");
  b.href = href;
  var head = document.head;
  if (head.firstChild) head.insertBefore(b, head.firstChild);
  else head.appendChild(b);
})();
