/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function get_paths(commit) {
  var paths = [];

  function process(directory) {
    directory.directories.forEach(process);
    directory.files.forEach(
      function (file) {
        if (/\.py$/.test(file.path) &&
            !/^(testing|installation)\//.test(file.path) &&
            !/^(install|upgrade|uninstall)\.py$/.test(file.path))
          paths.push(file.path);
      });
  }

  process(commit.getDirectory("/"));

  return paths;
}

function get_file_lines(commit, path, contexts, full) {
  var lines = [];

  lines.irrelevant = 0;
  lines.declaration = 0;
  lines.relevant = 0;
  lines.covered = 0;
  lines.irrelevant_covered = 0;
  lines.declaration_covered = 0;
  lines.relevant_covered = 0;

  commit.getFile(path).lines.forEach(
    function (line) {
      var category;

      if (/^\s*($|#)/.test(line)) {
        category = "irrelevant";
        ++lines.irrelevant;
      } else if (/^(def|class|import|from) /.test(line)) {
        category = "declaration";
        ++lines.declaration;
      } else {
        category = "relevant";
        ++lines.relevant;
      }

      lines.push({ category: category, contexts: null });
    });

  if (contexts) {
    for (var context in contexts) {
      contexts[context].forEach(
        function (index) {
          var line = lines[index];
          if (line.contexts === null) {
            ++lines.covered;
            switch (line.category) {
              case "irrelevant":
                ++lines.irrelevant_covered;
                break;
              case "declaration":
                ++lines.declaration_covered;
                break;
              case "relevant":
                ++lines.relevant_covered;
                break;
            }
            line.contexts = {};
          }
          line.contexts[context] = true;
        });
    }
  }

  if (full) {
    return lines;
  } else {
    return { length: lines.length,
             irrelevant: lines.irrelevant,
             declaration: lines.declaration,
             relevant: lines.relevant,
             covered: lines.covered,
             irrelevant_covered: lines.irrelevant_covered,
             declaration_covered: lines.declaration_covered,
             relevant_covered: lines.relevant_covered };
  }
}

function main(method, path, query) {
  var review = new critic.Review(parseInt(query.params.review));
  var result_key = query.params.key;

  writeln("200");
  writeln("Content-Type: text/html");
  writeln("");

  critic.html.writeStandardHeader(
    "Test Coverage",
    { stylesheets: ["/extension-resource/CriticTester/common.css",
                    "/extension-resource/CriticTester/coverage.css"],
      scripts: ["/extension-resource/CriticTester/common.js",
                "/extension-resource/CriticTester/coverage.js"],
      review: review });

  var cached_key = result_key.replace(/^result:/, "cached:");
  var cached_text = storage.get(cached_key);
  var cached;
  var html = "";

  if (!cached_text) {
    var result = JSON.parse(storage.get(result_key));

    if (result.message) {
      var message = result.message;

      html += format("<div class=%s><span class=title>%s:</span> <span class=message>%s</span></div>",
                     result.success ? "message" : "error",
                     result.success ? "Message" : "Testing error",
                     critic.html.escape(message));
    } else {
      var commit_sha1 = /^result:\d+:([^:]+):/.exec(result_key)[1];
      var commit = review.repository.getCommit(commit_sha1);
      var coverage = JSON.parse(result.stdout);

      delete coverage.contexts;

      cached = {};

      get_paths(commit).forEach(
        function (path) {
          cached[path] = get_file_lines(commit, path, coverage[path], false);
        });

      storage.set(cached_key, JSON.stringify(cached));
    }
  } else {
    cached = JSON.parse(cached_text);
  }

  if (cached) {
    html += "<table class=coverage>";

    var raw_description = "Unadjusted coverage.";
    var adjusted_description = "Adjusted coverage; excludes empty and comment lines.";
    var code_description = ("Adjusted coverage; also excludes lines with 'def', " +
                            "'class', 'import' or 'from' in the left-most column.");

    html += "<tr class=headings>";
    html += "<th class=path>Path</th>";
    html += format("<th class='raw ratio' title='%s'>Raw %%</th>",
                   critic.html.escape(raw_description));
    html += format("<th class='adjusted ratio' title='%s'>Adjusted %%</th>",
                   critic.html.escape(adjusted_description));
    html += format("<th class='code ratio' title='%s'>Code %%</th>",
                   critic.html.escape(code_description));
    html += "</tr>";

    var paths = Object.keys(cached);
    paths.sort();
    paths.forEach(
      function (path) {
        var lines = cached[path];

        var raw_ratio = lines.covered / lines.length;
        var adjusted_ratio = ((lines.declaration_covered + lines.relevant_covered) / 
                              (lines.declaration + lines.relevant));
        var code_ratio = lines.relevant_covered / lines.relevant;

        function format_ratio(ratio) {
          if (isNaN(ratio))
            return "N/A";
          else if (!ratio)
            return "";
          else
            return format("%.1f %%", 100 * ratio);
        }

        html += "<tr class=file>";
        html += format("<!-- %d %d %d %d %d %d -->",
                       lines.irrelevant, lines.declaration, lines.relevant,
                       lines.irrelevant_covered, lines.declaration_covered,
                       lines.relevant_covered);
        html += format("<td class=path>%s</td>", critic.html.escape(path));
        html += format("<td class='raw ratio'>%s</td>", format_ratio(raw_ratio));
        html += format("<td class='adjusted ratio'>%s</td>", format_ratio(adjusted_ratio));
        html += format("<td class='code ratio'>%s</td>", format_ratio(code_ratio));
        html += "</tr>";
      });

    html += "</table>";
  }

  var plt = new critic.html.PaleYellowTable("Code Coverage");

  plt.addItem({ html: html });
  plt.addItem({ buttons: { "Delete and re-test": format("deleteResult(%r);", result_key) }});
  plt.write();

  critic.html.writeStandardFooter();
}
