/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(method, path, query) {
  var data = JSON.parse(read());

  writeln("200");
  writeln("Content-Type: text/json");
  writeln("");

  try {
    var review = new critic.Review(data.review_id);

    var ready_to_push_reason = push_blocked_by(review);

    if (ready_to_push_reason)
      throw ready_to_push_reason;

    var work = review.branch.getWorkCopy();

    work.run("push",
	     format("%s.github.com:jensl/critic.git", critic.User.current.name),
	     "HEAD:refs/heads/master");

    review.close();

    writeln(JSON.stringify({ status: "ok" }));
  } catch (error) {
    writeln(JSON.stringify({ status: "failure",
			     code: "cannotpush",
			     title: "Will not push changes to master",
			     message: String(error) }));
  }
}
