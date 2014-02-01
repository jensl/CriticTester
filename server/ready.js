/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(method, path, query) {
  var data = JSON.parse(read());
  var review = new critic.Review(data.review_id);
  var push_blocked_by_ = push_blocked_by(review);
  var result = { status: "ok" };

  if (push_blocked_by_) {
    result.ready = false;
    result.push_blocked_by = push_blocked_by_;
  } else {
    result.ready = true;
  }

  writeln("200");
  writeln("Content-Type: text/json");
  writeln("");
  writeln(JSON.stringify(result));
}
