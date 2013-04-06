/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

$(function () {
  $("input[name='level']").click(
    function (ev) {
      var input = $(ev.currentTarget);
      var log = input.closest("div.level").next("table.log");
      var className = "show-" + input.attr("value");

      log.removeClass("show-debug show-info show-warning");
      log.addClass(className);
    });
});
