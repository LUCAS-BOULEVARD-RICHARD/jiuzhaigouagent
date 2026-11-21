/* 景区端启动确认：打开页面后先停留在欢迎页，由用户确认后进入工作台。 */
(function () {
  "use strict";
  const screen = document.getElementById("launch-screen");
  const confirm = document.getElementById("launch-confirm");
  if (!screen || !confirm) return;

  confirm.addEventListener("click", function () {
    screen.hidden = true;
    document.querySelectorAll("#app, .guest-launch, .hub-launch, .driver-launch")
      .forEach(function (el) { el.removeAttribute("inert"); });
    const heading = document.querySelector("#app h1, #app h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  });
})();
