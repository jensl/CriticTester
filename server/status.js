/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(path, query) {
  var data = JSON.parse(read() || query.params.data);
  var review = new critic.Review(data.review_id);

  writeln("200");
  writeln();

  if (review.repository.name != "critic") {
    writeln(JSON.stringify({
      status: "error",
      error: "invalid use"
    }));
  } else {
    var pending_tests = list_tests({ review_id: review.id,
                                     mode: "pending" })[review.id];
    var finished_tests = list_tests({ review_id: review.id,
                                      mode: "finished" })[review.id];
    var errors = false, warnings = false, pending = Boolean(pending_tests);
    var tests = {};

    if (finished_tests) {
      finished_tests.forEach(
	function (test) {
          var stats = JSON.parse(storage.get(test.stats_key));

          if (stats.errors)
            errors = true;
          if (stats.warnings)
            warnings = true;

          tests[/(.*):[^:]+$/.exec(test.key)[1]] = true;
	});
    }

    var skipped = Boolean(finished_tests);

    if (skipped) {
      for (var test_key in tests) {
	var stats = JSON.parse(storage.get(format("stats:%s", test_key)));

	if (typeof stats.skipped == "undefined")
          skipped = false;
	else if (stats.skipped < Object.keys(stats.instances).length)
          skipped = false;

	if (!skipped)
          break;
      }
    }

    var finished = !(errors || warnings || pending) && Boolean(finished_tests);
    var ready_to_push_reason = push_blocked_by(review, pending_tests, finished_tests);
    var ready_to_push = ready_to_push_reason === null;

    writeln(JSON.stringify({
      status: "ok",
      errors: errors,
      warnings: warnings,
      pending: pending,
      finished: finished,
      ready_to_push: ready_to_push,
      ready_to_push_reason: ready_to_push_reason,
      skipped: skipped,
      accepted: review.accepted,
      closed: review.state != "open",
      is_collaborator: is_collaborator(critic.User.current)
    }));
  }
}
