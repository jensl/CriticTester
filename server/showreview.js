/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(path, query) {
  writeln("stylesheet %s", JSON.stringify("/extension-resource/CriticTester/showreview.css"));
  writeln("script %s", JSON.stringify("/extension-resource/CriticTester/showreview.js"));
}
