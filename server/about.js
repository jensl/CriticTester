/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

function main(method, path, query) {
  writeln("200");
  writeln("Content-Type: text/tutorial");
  writeln("");
  write(IO.File.read("server/about.txt"));
}
