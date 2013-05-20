/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(method, path, query) {
  var review = new critic.Review(parseInt(query.params.review));

  writeln("200");
  writeln("Content-Type: text/html");
  writeln("");

  var title = format("Test Report: r/%d \"%s\"", review.id, review.summary);

  critic.html.writeStandardHeader(title,
                                  { stylesheets: ["/extension-resource/CriticTester/common.css",
                                                  "/extension-resource/CriticTester/report.css"],
                                    scripts: ["/extension-resource/CriticTester/common.js",
                                              "/extension-resource/CriticTester/report.js"],
                                    review: review });

  var plt = new critic.html.PaleYellowTable(title);

  function group_tests(all_tests) {
    var tests_table = {};
    var tests = [];
    all_tests.forEach(
      function (test) {
        var match = /^result:\d+:(.+):([^:]+)$/.exec(test.result_key);
        var base_key = match[1];
        var instance_id = match[2];

        if (!(base_key in tests_table)) {
          var grouped_test = { commit: test.commit,
                               commit_title: test.commit_title,
                               upgrade_from: test.upgrade_from,
                               upgrade_from_title: test.upgrade_from_title,
                               instance_ids: [instance_id] }
          tests_table[base_key] = grouped_test;
          tests.push(grouped_test);
        } else {
          tests_table[base_key].instance_ids.push(instance_id);
        }
      });
    return tests;
  }

  var finished_tests;
  var pending_tests;

  var all_finished_tests = list_tests({ review_id: review.id,
                                        mode: "finished" })[review.id];
  if (all_finished_tests)
    finished_tests = group_tests(all_finished_tests);

  var all_pending_tests = list_tests({ review_id: review.id,
                                       mode: "pending" })[review.id];
  if (all_pending_tests)
    pending_tests = group_tests(all_pending_tests);

  var html = "<table class=tests>";

  if (finished_tests) {
    html += "<tr class=title><th colspan=3>Finished Tests</th></tr>";
    html += "<tr class=headings>";
    html += "<th class=commit>Commit</th>";
    html += "<th class=upgrade_from>Upgrade From</th>";
    html += "<th class=coverage>Coverage</th>";
    html += "<th class=instances>Instances</th>";
    html += "</tr>";

    finished_tests.forEach(
      function (test) {
        function status(stats) {
          if (stats.errors)
            return "errors";
          else if (stats.warnings)
            return "warnings";
          else if (stats.skipped)
            return "skipped";
          else
            return "clean";
        }

        var coverage = test.instance_ids.filter(
          function (instance_id) {
            return instance_id == "coverage";
          })[0];
        var instance_ids = test.instance_ids.filter(
          function (instance_id) {
            return instance_id != "coverage";
          });
        var stats_key = generate_key("stats", review.id, test.commit, test.upgrade_from);
        var stats = JSON.parse(storage.get(stats_key));

        html += format("<tr class='test %s'>", status(stats));
        html += format("<td class=commit><a href='/%s?review=%d' title='%s'>%s</a></td>",
                       test.commit, review.id,
                       critic.html.escape(test.commit_title),
                       test.commit.substring(0, 8));
        if (test.upgrade_from) {
          html += format("<td class=upgrade_from><a href='/%s?review=%d' title='%s'>%s</a></td>",
                         test.upgrade_from, review.id,
                         critic.html.escape(test.upgrade_from_title),
                         test.upgrade_from.substring(0, 8));
        } else {
          html += "<td class=upgrade_from></td>";
        }

        html += "<td class=coverage>";
        if (coverage) {
          var instance_stats_key = format("%s:%s", stats_key, "coverage");
          var instance_stats = JSON.parse(storage.get(instance_stats_key));
          var result_key = generate_key("result", review.id, test.commit,
                                        test.upgrade_from, "coverage");
          html += format("<a class=%s href='coverage?review=%d&key=%s'>Coverage</a>",
                         status(instance_stats), review.id, result_key);
        } else {
        }
        html += "</td>";

        instance_ids.sort();

        var instances = [];
        var result_keys = [];

        instance_ids.forEach(
          function (instance_id) {
            var instance_stats_key = format("%s:%s", stats_key, instance_id);
            var instance_stats = JSON.parse(storage.get(instance_stats_key));

            var result_key = generate_key("result", review.id, test.commit,
                                          test.upgrade_from, instance_id);

            var url = format("log?review=%d&key=%s", review.id, result_key);

            instances.push(
              format("<a class=%s href='%s'>%s</a>",
                     status(instance_stats), url, instance_stats.description));
            result_keys.push(result_key);
          });

        if (instances.length > 1) {
          instances.push(
            format("<a class=%s href='log?review=%d&key=%s'>[all]</a>",
                   status(stats), review.id, result_keys.join(",")));
        }

        html += format("<td class=instances>%s</td>", instances.join(", "));
        html += "</tr>";
      });
  }

  if (pending_tests) {
    html += "<tr class=title><th colspan=3>Pending Tests</th></tr>";
    html += "<tr class=headings>";
    html += "<th class=commit>Commit</th>";
    html += "<th class=upgrade_from>Upgrade From</th>";
    html += "<th class=coverage>Coverage</th>";
    html += "<th class=instances>Instances</th>";
    html += "</tr>";

    pending_tests.forEach(
      function (test) {
        html += "<tr class=test>";
        html += format("<td class=commit><a href='/%s?review=%d' title='%s'>%s</a></td>",
                       test.commit, review.id,
                       critic.html.escape(test.commit_title),
                       test.commit.substring(0, 8));
        if (test.upgrade_from) {
          html += format("<td class=upgrade_from><a href='/%s?review=%d' title='%s'>%s</a></td>",
                         test.upgrade_from, review.id,
                         critic.html.escape(test.upgrade_from_title),
                         test.upgrade_from.substring(0, 8));
        } else {
          html += "<td class=upgrade_from></td>";
        }
        var has_coverage = test.instance_ids.indexOf("coverage") != -1;
        var instance_ids = test.instance_ids.filter(
          function (instance_id) {
            return instance_id != "coverage";
          });
        html += format("<td class=instances>%s</td>",
                       has_coverage ? "coverage" : "");
        html += format("<td class=instances>%s</td>",
                       critic.html.escape(instance_ids.join(", ")));
        html += "</tr>";
      });

    html += "<script>setTimeout(function () { location.reload(); }, 10000);</script>";
  }

  html += "</table>";

  plt.addItem({ html: html });
  plt.write();

  critic.html.writeStandardFooter();
}
