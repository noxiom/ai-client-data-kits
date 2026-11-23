// Guide pages: open the collapsed section a link points into, and make the
// comparison grid filterable and sortable. Reads and stores nothing; without
// JavaScript the grid is a plain table and the sections still open on click.
(function () {
  function openTo(id) {
    var el = id && document.getElementById(id);
    for (var d = el; d; d = d.parentElement) if (d.tagName === "DETAILS") d.open = true;
  }
  openTo(decodeURIComponent(location.hash.slice(1)));
  window.addEventListener("hashchange", function () {
    openTo(decodeURIComponent(location.hash.slice(1)));
  });
  document.addEventListener("click", function (event) {
    var link = event.target.closest('a[href^="#"]');
    if (link) openTo(link.getAttribute("href").slice(1));
  });

  var table = document.getElementById("matrix");
  var controls = document.getElementById("matrixControls");
  if (!table || !controls) return;
  var body = table.tBodies[0];
  var rows = Array.prototype.slice.call(body.rows);
  var state = { account: "all", tool: "all" };
  controls.hidden = false;

  controls.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) return;
    var key = button.hasAttribute("data-account") ? "account" : "tool";
    state[key] = button.getAttribute("data-" + key);
    button.parentElement.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b === button));
    });
    rows.forEach(function (row) {
      row.hidden =
        (state.account !== "all" && row.getAttribute("data-account") !== state.account) ||
        (state.tool !== "all" && row.getAttribute("data-tool") !== state.tool);
    });
  });

  table.querySelectorAll("button.sort").forEach(function (button) {
    button.addEventListener("click", function () {
      var col = Number(button.getAttribute("data-col"));
      var th = button.parentElement;
      var dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
      table.querySelectorAll("th[aria-sort]").forEach(function (h) {
        h.setAttribute("aria-sort", "none");
      });
      th.setAttribute("aria-sort", dir);
      var sign = dir === "ascending" ? 1 : -1;
      rows
        .slice()
        .sort(function (a, b) {
          var diff = Number(a.cells[col].getAttribute("data-sort")) - Number(b.cells[col].getAttribute("data-sort"));
          return diff !== 0 ? sign * diff : Number(a.getAttribute("data-order")) - Number(b.getAttribute("data-order"));
        })
        .forEach(function (row) {
          body.appendChild(row);
        });
    });
  });
})();
