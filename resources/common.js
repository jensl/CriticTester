/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

function deleteResult(result_key) {
  var operation = new critic.Operation({ url: "CriticTester/delete",
                                         action: "Delete results ...",
                                         data: { result_key: result_key }});
  if (operation.execute())
    location.href = "report?review=" + critic.review.id;
}
