/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function repeat(s, n)
{
  return Array(n + 1).join(s);
}

function update_review(review_id) {
  var finished_tests = list_tests({ review_id: review_id,
                                    mode: "finished" })[review_id];
  var has_errors = false, has_warnings = false;
  var errors = {};

  function add_error(entries, instance) {
    var key = [];
    entries.forEach(
      function (entry) {
        key.push([entry.level, entry.message]);
      });
    key = JSON.stringify(key);
    if (!(key in errors))
      errors[key] = { entries: entries, instances: {} };
    errors[key].instances[instance] = true;
  }

  if (finished_tests) {
    finished_tests.forEach(
      function (test) {
        var stats = JSON.parse(storage.get(test.stats_key));

        if (stats.errors)
          has_errors = true;
        if (stats.warnings)
          has_warnings = true;

        if (stats.errors || stats.warnings) {
          var instance = /:([^:]+)$/.exec(test.key)[1];
          var data = JSON.parse(storage.get(test.result_key));

          if (data.stdout) {
            var result = parse_log(data.stdout);
            var current_test = null;
            var current_error = null;

            result.entries.forEach(
              function (entry) {
                if (current_error) {
                  switch (entry.level) {
                    case "error":
                    case "warning":
                      current_error.push(entry);
                      return;

                    case "debug":
                    case "stdout":
                    case "stderr":
                      break;

                    default:
                      add_error(current_error, instance);
                      current_error = null;
                  }
                }

                if (entry.level == "info" && /^Running: /.test(entry.message)) {
                  current_test = entry;
                } else if (entry.level == "info") {
                  current_test = null;
                } else if (entry.level == "error" || entry.level == "warning") {
                  current_error = [];
                  if (current_test)
                    current_error.push(current_test);
                  current_error.push(entry);
                }
              });
          }
        }
      });
  }

  if (has_errors || has_warnings) {
    open_review_issue(review_id);

    var review = new critic.Review(review_id);
    var mail_transaction = new critic.MailTransaction();

    var body = format("The automatic testing of r/%d has detected problems!\n\n\n",
                      review.id);

    body += format("Full test report:\n" +
                   "  https://critic-review.org/CriticTester/report?review=%d\n\n",
                   review.id);

    if (Object.keys(errors).length) {
      for (var key in errors) {
        var error = errors[key];
        var instances = Object.keys(error.instances);

        instances.sort();

        body += format("\nFailed in: %s\n", instances.join(", "));
        body += repeat("=", 70) + "\n";

        error.entries.forEach(
          function (entry) {
            body += format("%-8s| %s\n", entry.level.toUpperCase(), entry.message[0]);
            for (var index = 1; index < entry.message.length; ++index)
              body += format("        | %s\n", entry.message[index]);
          });

        body += repeat("=", 70) + "\n\n";
      }
    }

    //body += "-- the Critic tester\n"

    mail_transaction.add({
      review: review,
      subject: format("Test Report: %s", review.summary),
      body: body 
    });

    mail_transaction.finish();
  } else {
    close_review_issue(review_id);
  }
}

function main(method, path, query) {
  var data = JSON.parse(read() || query.params.data);
  var updated_tests = {};

  Object.keys(data).forEach(
    function (review_id) {
      review_id = parseInt(review_id);

      data[review_id].forEach(
        function (test) {
          var key = generate_key(null, review_id, test.commit,
                                 test.upgrade_from);

          updated_tests[key] = true;

          for (var instance_id in test.result) {
            var instance_data = test.result[instance_id];
            var instance_stats = { description: instance_data.description,
                                   elapsed: instance_data.elapsed,
                                   errors: 0, warnings: 0, skipped: false };

            if (!instance_data.success) {
              ++instance_stats.errors;
            } else if (instance_data.stdout) {
              if (test["type"] == "normal") {
                var parsed = parse_log(instance_data.stdout);

                instance_stats.errors += parsed.errors;
                instance_stats.warnings += parsed.warnings;
              }
            } else if (instance_data.message == "not tested" ||
                       instance_data.message == "coverage not supported" ||
                       instance_data.message == "debian7 not supported") {
              instance_stats.skipped = true;
            }

            var result_key = generate_key("result", review_id, test.commit,
                                          test.upgrade_from, instance_id);
            var stats_key = generate_key("stats", review_id, test.commit,
                                         test.upgrade_from, instance_id);

            storage.set(result_key, JSON.stringify(instance_data));
            storage.set(stats_key, JSON.stringify(instance_stats));
          }
        });
    });

  for (var key in updated_tests) {
    var instances_key = format("instances:%s", key);
    var instances = JSON.parse(storage.get(instances_key));

    var stats_key = format("stats:%s", key);
    var stats = { errors: 0, warnings: 0, skipped: 0, instances: {} };

    instances.forEach(
      function (instance_id) {
        var instance_stats_key = format("%s:%s", stats_key, instance_id);
        var instance_stats_text = storage.get(instance_stats_key);

        if (instance_stats_text) {
          var instance_stats = JSON.parse(instance_stats_text);

          stats.errors += instance_stats.errors;
          stats.warnings += instance_stats.warnings;
          if (instance_id != "coverage" && instance_stats.skipped)
            ++stats.skipped;
          stats.instances[instance_id] = instance_stats;
        }
      });

    storage.set(stats_key, JSON.stringify(stats));
  }

  Object.keys(data).forEach(
    function (review_id) {
      review_id = parseInt(review_id);

      var pending = list_tests({ review_id: review_id,
                                 mode: "pending" })[review_id];

      if (!pending)
        update_review(review_id);
    });

  writeln("200");
  writeln("Content-Type: text/json");
  writeln("");
  writeln(JSON.stringify({ status: "ok" }));
}