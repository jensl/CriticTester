/* -*- mode: js; indent-tabs-mode: nil -*- */

"use strict";

Module.load("common.js");

function main(method, path, query) {
  var review = new critic.Review(parseInt(query.params.review));
  var result_keys = query.params.key.split(",");

  writeln("200");
  writeln("Content-Type: text/html");
  writeln("");

  critic.html.writeStandardHeader("Test Log",
                                  { stylesheets: ["/extension-resource/CriticTester/common.css",
                                                  "/extension-resource/CriticTester/log.css"],
                                    scripts: ["/extension-resource/CriticTester/common.js",
                                              "/extension-resource/CriticTester/log.js"],
                                    review: review });

  var plt = new critic.html.PaleYellowTable("Test Log");

  result_keys.forEach(
    function (result_key) {
      var data = JSON.parse(storage.get(result_key));

      plt.addHeading(data.description);

      var html = "";

      if (data.message) {
        var message = data.message;

        if (message == "not tested")
          message = "testing skipped (not relevant)";

        html += format("<div class='%s'><span class=title>%s:</span> <span class=message>%s</span></div>",
                       data.success ? "message" : "message error",
                       data.success ? "Message" : "Testing error",
                       critic.html.escape(message));
      }

      if (data.stderr) {
        html += "<div class=stderr>";
        html += "<b>Output:</b>";
        html += "<div><pre>";
        html += critic.html.escape(data.stderr);
        html += "</pre></div></div>";
      }

      if (data.stdout) {
        html += "<div class=level><form>";
        html += "<label><input type=radio name=level value=debug> Show DEBUG</label>";
        html += "<label><input type=radio name=level value=info checked> Show INFO</label>";
        html += "<label><input type=radio name=level value=warning> Only show WARNING &amp; ERROR</label>";
        html += "</form></div>";

        html += "<table class='log show-info'>";
        html += "<tr class=headings>";
        html += "<th class=time>Time</th>";
        html += "<th class=level>Level</th>";
        html += "<th class=text>Text</th>";
        html += "</tr>";

        var result = parse_log(data.stdout);

        for (var entry_index = 0; entry_index < result.entries.length; ++entry_index) {
          var entry = result.entries[entry_index];
          var time;

          if (entry_index > 0)
            time = format("%.3f", entry.delta / 1000);
          else
            time = "";

          var actual_level;
          if (entry.level == "stdout" || entry.level == "stderr")
            actual_level = "debug";
          else
            actual_level = entry.level;

          html += format("<tr class='entry %s'>", actual_level);
          html += format("<td class=time>%s</td>", time);
          html += format("<td class=level>%s</td>", entry.level.toUpperCase());
          html += format("<td class=text>%s</td>",
                         critic.html.escape(entry.message[0]));
          html += "</tr>";

          for (var index = 1; index < entry.message.length; ++index) {
            html += format("<tr class='entry continued %s'>", entry.level);
            html += "<td class=empty colspan=2></td>";
            html += format("<td class=text>%s</td>",
                           critic.html.escape(entry.message[index]) || "&nbsp;");
            html += "</tr>";
          }
        }

        html += "</table>";
      }

      plt.addItem({ html: html });
      plt.addItem({ buttons: { "Delete and re-test": format("deleteResult(%r);", result_key) }});
    });

  plt.write();

  critic.html.writeStandardFooter();
}
