// Kit pages: copy buttons for ready-made text. Reads and stores nothing.
(function () {
  "use strict";
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    var target = document.getElementById(button.getAttribute("data-copy"));
    if (!target || !navigator.clipboard) return;
    button.hidden = false;
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(target.textContent.trim()).then(function () {
        var label = button.textContent;
        button.textContent = button.getAttribute("data-copied") || "Copied";
        setTimeout(function () { button.textContent = label; }, 2000);
      });
    });
  });
})();
