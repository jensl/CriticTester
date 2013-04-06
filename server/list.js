/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(method, path, query) {
  var data = JSON.parse(read());
  var tests = list_tests({ instances: data.instances,
                           mode: "pending" });

  for (var review_id in tests)
    open_review_issue(parseInt(review_id));

  writeln("200");
  writeln("Content-Type: text/json");
  writeln("");
  writeln(JSON.stringify({ status: "ok", tests: tests }));
}
