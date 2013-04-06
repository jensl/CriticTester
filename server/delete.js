/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(method, path, query) {
  var data = JSON.parse(read());

  writeln("200");
  writeln("Content-Type: text/json");
  writeln("");

  if (!critic.User.current.isAnonymous) {
    storage.remove(data.result_key);
    storage.remove(data.result_key.replace(/^result:/, "stats:"));

    writeln(JSON.stringify({ status: "ok" }));
  } else {
    writeln(JSON.stringify({ status: "failure",
			     code: "notallowed",
			     title: "Not allowed",
			     message: "You must sign in to delete test results." }));
  }
}
