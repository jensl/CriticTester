/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(path, query) {
  if (!query || !query.params || !query.params.coverage)
    return;

  var result_key = query.params.coverage;
  var result_sha1 = /^result:\d+:([^:]+):/.exec(result_key)[1];

  var request_path = query.params.path;
  var request_sha1 = query.params.sha1;

  if (result_sha1.substring(0, request_sha1.length) != request_sha1)
    throw Error(format("Result/request SHA-1 mismatch: %s vs %s",
		       result_sha1, request_sha1));

  var result = JSON.parse(storage.get(result_key));
  var coverage = JSON.parse(result.stdout);
  var match = /^src\/(.*)$/.exec(request_path);
  var coverage_path = match ? match[1] : null;

  if (!coverage_path || !(coverage_path in coverage))
    throw Error(format("No coverage information: %s", request_path));

  writeln("script %r", format("data:text/javascript,var coverage=%r",
			      coverage[coverage_path]));

  writeln("stylesheet %s", JSON.stringify("/extension-resource/CriticTester/showfile.css"));
  writeln("script %s", JSON.stringify("/extension-resource/CriticTester/showfile.js"));
}
