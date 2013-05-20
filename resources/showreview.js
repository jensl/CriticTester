/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

$(function () {
  function pushToMaster() {
    function finished(result) {
      if (result)
        location.reload();
    }

    if (CriticTester.ready_to_push) {
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
                  "<p><b>Reason:</b> " + CriticTester.ready_to_push_reason +
                  "</p>");
    }
  }

  var status_class, status_text;

  switch (true) {
    case CriticTester.errors:
      status_class = "errors";
      status_text = "has ERRORS!";
      break;

    case CriticTester.warnings:
      status_class = "warnings";
      status_text = "has warnings!";
      break;

    case CriticTester.pending:
      status_class = "pending";
      status_text = "pending...";
      break;

    case CriticTester.skipped:
      status_class = "clear";
      status_text = "skipped";
      break;

    case CriticTester.finished:
      status_class = "clear";
      status_text = "perfect!";
      break;

    default:
      status_class = "nottested";
      status_text = "not tested";
  }

  $("table.progress h1 .right").prepend(
    "<div class='testing-status " + status_class + "'>" +
      "Testing status: <span class=status>" + status_text + "</span></div>")

  if (status_class != "nottested") {
    $("div.testing-status").addClass("clickable").click(
      function (ev) {
        location.href = "/CriticTester/report?review=" + critic.review.id;
      });
  }

  if (!CriticTester.closed && CriticTester.is_collaborator) {
    critic.buttons.add({ title: "Push to master",
                         onclick: pushToMaster,
                         scope: "global" });
  }
});
