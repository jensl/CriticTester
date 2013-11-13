/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

var BASE_URL = "http://test.critic-review.org/";

function main(method, path, query) {
  var storage = new critic.Storage(new critic.User("tester"));
  var custom = JSON.parse(storage.get("custom"));

  function error(message) {
    writeln("404");
    writeln("Content-Type: text/html");
    writeln("");
    writeln("<h1>%s</h1>", message);
  }

  if (custom.sha1 === null)
    return error("No custom test active!");
  if (!custom.up)
    return error("Test VM not up!");
  if (!/^(GET|HEAD|POST)$/.test(method))
    return error(format("Unsupported method: %r!", method));

  function getStatus(request) {
    return parseInt(/^HTTP\/1\.[01] (\d+)/.exec(request.statusLine)[1]);
  }

  var signin = custom.signin;

  if (signin) {
    if (!custom.sid) {
      var request = new URL.Request("POST", BASE_URL + "/validatelogin");
      request.setRequestHeader("Content-Type", "text/json");
      request.setRequestBody(Bytes.encode(JSON.stringify({
	"username": signin,
	"password": "testing" })));
      request.perform();
      if (getStatus(request) == 200) {
	request.responseHeaders.forEach(
	  function (header) {
	    if (header.name.toLowerCase() == "set-cookie") {
	      var match = /^sid=([^;]+)/.exec(header.value);
	      if (match) {
		var sid = match[1];
		if (sid != "invalid") {
		  custom.sid = sid;
		  storage.set("custom", JSON.stringify(custom));
		}
	      }
	    }
	  });
      }
    }
  } else {
    if (custom.sid) {
      custom.sid = null;
      storage.set("custom", JSON.stringify(custom));
    }
  }

  var target_url = BASE_URL + path;
  if (query)
    target_url += "?" + query.raw;
  var request = new URL.Request(method, target_url);

  if (custom.sid)
    request.setRequestHeader("Cookie", "has_sid=1; sid=" + custom.sid);

  if (method == "POST")
    request.setRequestBody(read());

  request.perform();

  writeln("%d", getStatus(request));

  request.responseHeaders.forEach(
    function (header) {
      switch (header.name.toLowerCase()) {
      case "transfer-encoding":
      case "content-length":
	break;

      default:
	writeln("%(name)s: %(value)s", header);
      }
    });

  writeln();
  write(request.responseBody);
}
