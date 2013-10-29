/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";


$(function () {
  var lines = [];

  for (var context in coverage) {
    coverage[context].forEach(
      function (index) {
	if (!(index in lines))
	  lines[index] = [];
	lines[index].push(context);
      });
  }

  var lineid_prefix = /^(.*)o\d+n\d+$/.exec($("tr.line").get(0).id)[1];

  lines.forEach(
    function (contexts, index) {
      var linenr = index + 1;
      var line = $("#" + lineid_prefix + "o" + linenr + "n" + linenr);

      line.addClass("covered");
      line.attr("critic-contexts", JSON.stringify(contexts));
    });

  $("tr.line:not(tr.covered)").each(
    function () {
      var line = $(this).find("td.line");

      if (/^\s*($|#)/.test(line.text()) || line.find(":not(b.str)").size() == 0)
	return;
      else if (/^\s*(def|class|import|from) |else:|^\s+pass$/.test(line.text()))
	$(this).addClass("uncovered-decl");
      else
	$(this).addClass("uncovered");
    });
});
