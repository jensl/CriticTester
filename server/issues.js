/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

function get_changeset(review, reference, subject) {
  return 
}

function main(method, path, query) {
  var data = JSON.parse(read());

  function finish(result) {
    result = result || { status: "ok" };

    writeln("200");
    writeln();
    writeln(JSON.stringify(result));
  }

  var review = new critic.Review(data.review_id);
  var reference = review.repository.getCommit(data.reference.sha1);
  var subject = review.repository.getCommit(data.subject.sha1);
  var changeset = review.repository.getChangeset(reference, subject);

  var chains = {};
  var file_sha1s = {};

  function get_file_sha1(path) {
    if (!(path in file_sha1s))
      file_sha1s[path] = subject.getFile(path).sha1;
    return file_sha1s[path];
  }

  var chains_by_location = {};

  critic.CommentChain.find({ review: review,
			     commit: subject })
    .forEach(
      function (chain) {
	if (chain.file && chain.user.name == "tester") {
	  var extent = chain.lines[get_file_sha1(chain.file.path)];
	  var location = format("%s:%d", chain.file.path, extent.firstLine);
	  if (!(location in chains_by_location[location]))
	    chains_by_location[location] = [];
	  chains_by_location[location].push(chain);
	}
      });

  data.issues.forEach(
    function (issue) {
      var location = format("%s:%d", issue.path, issue.line);
      var chains = chains_by_location[location];

      if (chains
    });
}