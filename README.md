CriticTester
============

CriticTester is an extension for the [Critic code review system]
[critic].  It contains a client-side part which runs on a (possibly)
separate system and a server-side part which adds an API that the
client-side part uses, and various UI additions for presenting testing
status and results.

Installation
------------

To install the extension in a Critic system, a user would create a
directory named `CriticExtensions` in his/her `$HOME`, and clone the
CriticTester repository into that directory.  If done correctly, the
file `$HOME/CriticExtensions/CriticTester/MANIFEST` should exist.

Also, `$HOME` should be world executable, and `$HOME/CriticExtensions`
should be world readable (and directories executable) for the Critic
system to be able to find and use the extension.

For more information about Critic extensions, see the [extensions
tutorial] [tutorial].  This tutorial is available in any Critic system
that is sufficiently up-to-date to have extension support.


[critic]: https://github.com/jensl/critic "Critic on GitHub"
[tutorial]: http://critic-review.org/tutorial?item=extensions "Extensions tutorial"
