/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

var storage = new critic.Storage(new critic.User("tester"));

function generate_key(type, review_id, commit, upgrade_from, instance) {
  if (typeof commit == "object")
    commit = commit.sha1;

  var key = type ? format("%s:", type) : "";

  key += format("%d:%s", review_id, commit.substring(0, 20));

  if (upgrade_from) {
    if (typeof upgrade_from == "object")
      upgrade_from = upgrade_from.sha1;

    key = format("%s:%s", key, upgrade_from.substring(0, 20));
  }

  if (instance)
    key = format("%s:%s", key, instance);

  return key;
}

function tests_from_commits(review, commits, instances, mode) {
  var added = {};
  var tests = [];

  function maybe_add(data) {
    var commit = data.subject;
    var upgrade_from = data.upgrade_from;

    var instances_key = generate_key("instances", review.id, commit, upgrade_from);
    var instances_text = storage.get(instances_key);
    var use_instances;

    if (instances) {
      if (!instances_text || JSON.stringify(instances) != instances_text)
        storage.set(instances_key, JSON.stringify(instances));
      use_instances = instances;
    } else {
      if (instances_text)
        use_instances = JSON.parse(instances_text);
      else
        use_instances = ["<unknown>"];
    }

    use_instances.forEach(
      function (instance) {
        var key = generate_key(null, review.id, commit, upgrade_from, instance);
        var result_key = generate_key("result", review.id, commit, upgrade_from, instance);
        var stats_key = generate_key("stats", review.id, commit, upgrade_from, instance);

        var type;
        if (instance == "coverage") {
          if (upgrade_from || commit.sha1 != review.branch.head.sha1)
            return;
          type = "coverage";
        } else {
          type = "normal";
        }

        if (storage.get(result_key) && storage.get(stats_key)) {
          if (mode == "pending")
            return;
        } else if (mode == "finished") {
          return;
        }

        if (!(result_key in added)) {
          added[result_key] = true;

          var test = { type: type,
                       key: key,
                       result_key: result_key,
                       stats_key: stats_key,
                       commit: commit.sha1,
                       commit_title: commit.summary };

          if (upgrade_from) {
            test.upgrade_from = upgrade_from.sha1;
            test.upgrade_from_title = upgrade_from.summary;
          } else {
            test.parents = data.parents.map(
              function (parent) { return parent.sha1; });
          }

          tests.push(test);
        }
      });
  }

  var test_commits = [];

  for (var index1 = commits.length - 1; index1 >= 0; --index1) {
    var commit = commits[index1];
    var match = /^(?:fixup|squash)![ \t]+([^\n]+)(?:\n|$)/.exec(commit.message);

    if (match) {
      var reference = match[1];

      for (var index2 = test_commits.length - 1; index2 >= 0; --index2) {
        var test_commit = test_commits[index2];
        if (test_commit.subject == reference ||
            test_commit.sha1.substring(0, reference.length) == reference) {
          test_commits.splice(index2, 1);
          test_commit.actual = commit;
          test_commit.enabled = true;
          test_commits.push(test_commit);
          break;
        }
      }

      if (index2 >= 0) {
        for (; index2 < test_commits.length - 1; ++index2)
          test_commits[index2].enabled = false;
        continue;
      }
    }

    var test_commit = { actual: commit,
                        parents: commit.parents,
                        enabled: true };
    var match = /^([^\n]+)/.exec(commit.message);
    if (match)
      test_commit.subject = match[1];
    test_commit.sha1 = commit.sha1;
    test_commits.push(test_commit);
  }

  var upstreams = commits.upstreams;
  var processed = {};

  test_commits.reverse().forEach(
    function (test_commit) {
      if (test_commit.enabled) {
        var commit = test_commit.actual;

        if (!(commit.sha1 in processed)) {
          processed[commit.sha1] = true;

          maybe_add({ subject: commit,
                      parents: test_commit.parents });

          test_commit.parents.forEach(
            function (parent) {
              maybe_add({ subject: commit,
                          upgrade_from: parent });
            });

          upstreams.forEach(
            function (upstream) {
              maybe_add({ subject: commit,
                          upgrade_from: upstream });
            });
        }
      }
    });

  return tests;
}

function list_tests(data) {
  var instances = data.instances;
  var review_id = data.review_id;
  var mode = data.mode;

  var repository = new critic.Repository("critic");
  var reviews;

  if (typeof review_id == "number")
    reviews = [new critic.Review(review_id)];
  else if (typeof critic.Review.list == "function")
    reviews = critic.Review.list({ repository: repository,
                                   state: "open" });
  else
    reviews = critic.Review.find({ state: "open" });

  /* Reviews based on commits earlier than this are not supported by
     the tester. */
  var git_daemon_port = repository.getCommit(
    "51857cd696420d18a1274a4ede1faa2534733f7d");

  if (instances)
    instances.sort();

  var tests = {};

  reviews.forEach(
    function (review) {
      if (!git_daemon_port.isAncestorOf(review.branch.head))
        return;

      var review_tests = tests_from_commits(review, review.branch.commits, instances, mode);

      if (review_tests.length)
        tests[review.id] = review_tests;
    });

  return tests;
}

var LOG_LINE = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d),(\d{3}) \|\s+([A-Z]+)\s+\| (.*)$/;

function parse_log(log) {
  function int(string) {
    return parseInt(/^0*(\d+)$/.exec(string)[1]);
  }

  var lines = log.trim().split("\n");
  var entries = [];
  var errors = 0;
  var warnings = 0;
  var start = null;

  lines.forEach(
    function (line) {
      var match = LOG_LINE.exec(line);
      if (match) {
        var datetime = new Date(int(match[1]), int(match[2]) - 1, int(match[3]),
                                int(match[4]), int(match[5]), int(match[6]),
                                int(match[7]));
        var level = match[8].trim().toLowerCase();
        var message = match[9];
        var delta;

        if (level == "error")
          ++errors;
        else if (level == "warning")
          ++warnings;

        if (start === null) {
          start = datetime.getTime();
          delta = 0;
        } else {
          delta = datetime.getTime() - start;
        }

        entries.push({ delta: delta,
                       level: level,
                       message: [message] });
      } else {
        entries[entries.length - 1].message.push(line);
      }
    });

  return { errors: errors,
           warnings: warnings,
           entries: entries };
}

function get_review_issue(review) {
  for (var index = 0; index < review.commentChains.length; ++index) {
    var chain = review.commentChains[index];
    if (chain.type == critic.CommentChain.TYPE_ISSUE &&
        chain.user.id == critic.User.current.id)
      return chain;
  }

  var batch = review.startBatch();

  batch.raiseIssue(
    format("AUTOMATIC TESTING STATUS\n" +
           "\n" +
           "Report: https://critic-review.org/CriticTester/report?review=%d\n" +
           "\n" +
           "This issue is created and kept open by the automatic testing system " +
           "when there are pending tests to run, or testing has shown errors.  " +
           "It is closed automatically whenever the current test result is good.\n" +
           "\n" +
           "For more information about the automatic testing system, see " +
           "https://critic-review.org/CriticTester/about.",
           review.id));
  batch.finish({ silent: !review.progress.accepted });

  return get_review_issue(review.id);
}

function close_review_issue(review_id) {
  var review = new critic.Review(review_id);
  var issue = get_review_issue(review);

  if (issue.state == critic.CommentChain.STATE_OPEN) {
    var batch = review.startBatch();

    batch.resolveIssue(issue);
    batch.finish({ silent: String(review.progress) != "100 % and 1 issue" });
  }
}

function open_review_issue(review_id) {
  var review = new critic.Review(review_id);
  var issue = get_review_issue(review);

  if (issue.state == critic.CommentChain.STATE_RESOLVED) {
    var batch = review.startBatch();

    batch.reopenIssue(issue);
    batch.finish({ silent: !review.progress.accepted });
  }
}

function push_blocked_by(review, pending_tests, finished_tests) {
  if (!finished_tests)
    finished_tests = list_tests({ review_id: review.id,
                                  mode: "finished" })[review.id];

  if (finished_tests) {
    var errors = false, warnings = false;

    finished_tests.forEach(
      function (test) {
        var stats = JSON.parse(storage.get(test.stats_key));

        if (stats.errors)
          errors = true;
        if (stats.warnings)
          warnings = true;
      });

    if (errors)
      return "testing has errors";

    if (warnings)
      return "testing has warnings";
  } else {
    return "testing has not run";
  }

  if (!pending_tests)
    pending_tests = list_tests({ review_id: review.id,
                                 mode: "pending" })[review.id];

  if (pending_tests)
    return "there are pending tests";

  if (!review.progress.accepted)
    return "review not accepted";

  var collaborators = JSON.parse(storage.get("collaborators") || "[]");

  if (collaborators.indexOf(critic.User.current.name) == -1)
    return "you are not a collaborator";

  var commits = review.branch.commits;

  if (commits.upstreams.length != 1)
    return "review has multiple upstreams (needs rebase)";

  if (commits.upstreams[0].sha1 != review.repository.revparse("master"))
    return "review not based on tip of master (needs rebase)";

  var has_followups = false;

  try {
    commits.forEach(
      function (commit) {
        if (/^(fixup|squash)!/.test(commit.message))
          throw "followups";
      });
  } catch (error) {
    if (error == "followups")
      has_followups = true;
    else
      throw error;
  }

  if (has_followups)
    return "review contains fixup!/squash! commits (needs rebase)";

  return null;
}
