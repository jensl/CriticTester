/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(path, query) {
  var review_id = parseInt(query.params.id);
  var review = new critic.Review(review_id);
  var user = (query.params.user
              ? new critic.User({ name: query.params.user })
              : critic.User.current);

  if (review.repository.name != "critic")
    return;

  var pending_tests = list_tests({ review_id: review_id,
                                   mode: "pending" })[review_id];
  var finished_tests = list_tests({ review_id: review_id,
                                    mode: "finished" })[review_id];
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

  writeln("stylesheet %s", JSON.stringify("/extension-resource/CriticTester/showreview.css"));
  writeln("script %s", JSON.stringify("/extension-resource/CriticTester/showreview.js"));
  writeln("script %s", JSON.stringify(
    format("data:text/javascript," +
           "var CriticTester={errors:%r,warnings:%r,pending:%r,finished:%r," +
           "ready_to_push:%r,ready_to_push_reason:%r,skipped:%r,closed:%r," +
           "is_collaborator:%r};",
           errors, warnings, pending, finished, ready_to_push,
           ready_to_push_reason, skipped, review.state != "open",
           is_collaborator(user))));
}
