/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

$(function () {
  $("table.progress h1 .right").prepend(
    "<div class='testing-status checking'>" +
      "Testing status: <span class='status'>Checking...</span></div>")

  function updateStatus(result) {
    if (!result)
      return;

    function pushToMaster() {
      function finished(result) {
        if (result)
          location.reload();
      }

      if (result.ready_to_push) {
        var operation = new critic.Operation(
          { action: "push to master",
            url: "CriticTester/push",
            data: { review_id: critic.review.id },
            wait: "Pushing to master ...",
            callback: finished });

        operation.execute();
      } else {
        showMessage("Not supported!", "Not supported!",
                    "<p>The changes in this review can not be pushed to " +
                    "master at this time.</p>" +
                    "<p><b>Reason:</b> " + result.ready_to_push_reason +
                    "</p>");
      }
    }

    var status_class, status_text;

    switch (true) {
      case result.errors:
        status_class = "errors";
        status_text = "has ERRORS!";
        break;

      case result.warnings:
        status_class = "warnings";
        status_text = "has warnings!";
        break;

      case result.pending:
        status_class = "pending";
        status_text = "pending...";
        break;

      case result.skipped:
        status_class = "clear";
        status_text = "skipped";
        break;

      case result.finished:
        status_class = "clear";
        status_text = "perfect!";
        break;

      default:
        status_class = "nottested";
        status_text = "not tested";
    }

    var testing_status = $("div.testing-status");

    testing_status.removeClass("checking");
    testing_status.addClass(status_class);
    testing_status.find("span.status").text(status_text);

    if (status_class != "nottested") {
      testing_status.addClass("clickable").click(
        function (ev) {
          location.href = "/CriticTester/report?review=" + critic.review.id;
        });
    }

    if (result.finished &&
        result.accepted &&
        result.is_collaborator &&
        !result.closed) {
      critic.buttons.add({ title: "Push to master",
                           onclick: pushToMaster,
                           scope: "global" });
    }
  }

  var operation = new critic.Operation({
    action: "fetch testing status",
    url: "CriticTester/status",
    data: { review_id: critic.review.id },
    callback: updateStatus
  });

  operation.execute();
});
