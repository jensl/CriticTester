import sys
import os
import argparse
import subprocess
import json
import tempfile
import shutil
import fcntl
import errno
import select
import time
import signal
import logging
import logging.handlers
import datetime
import cStringIO
import traceback
import multiprocessing

import utils

USE_PASSLIB_SHA1 = "5d545b0b957b4c942a01ca9f0133547eafcf8f96"

configuration = json.load(open("configuration.json"))
instances = json.load(open("instances.json"))

parser = argparse.ArgumentParser("CriticTester: test runner")
parser.add_argument("--instance", help="Instance to test in", required=True)

arguments = parser.parse_args()

activity_timeout = configuration["activity-timeout"]
overall_timeout = configuration["overall-timeout"]

logging.basicConfig(format="%(message)s", stream=sys.stdout)
logger = logging.getLogger("custom")

critic = utils.Critic()

for instance in instances:
    if arguments.instance.startswith(instance["identifier"]):
        if "clones" in instance:
            for clone in instance["clones"]:
                if arguments.instance == clone["identifier"]:
                    actual = clone
                    break
            else:
                sys.stderr.write("Invalid --instance; not configured in instances.json.\n")
                sys.exit(1)
        elif arguments.instance != instance["identifier"]:
            sys.stderr.write("Invalid --instance; not configured in instances.json.\n")
            sys.exit(1)
        else:
            actual = instance
        break
else:
    sys.stderr.write("Invalid --instance; not configured in instances.json.\n")
    sys.exit(1)

logger.error("---")
logger.error("--- Instance: %s (%s)" % (instance["identifier"], actual["identifier"]))
logger.error("---")

class Context(object):
    def __init__(self, value, callback, *args):
        self.value = value
        self.callback = callback
        self.args = args
    def __enter__(self):
        return self.value
    def __exit__(self, *_):
        try:
            self.callback(*self.args)
        except Exception:
            traceback.print_exc()
        return False

def setnonblocking(fd):
    fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) | os.O_NONBLOCK)

def run_test(custom_id, custom_sha1):
    start = time.time()

    commit_sha1 = subprocess.check_output(
        ["git", "rev-parse", "--verify", "--quiet", custom_sha1],
        cwd=configuration["critic.git"]).strip()

    def prepare_repositories():
        base_path = tempfile.mkdtemp()
        repository_path = os.path.join(base_path, "critic")

        try:
            subprocess.check_output(
                ["git", "clone", "--quiet", configuration["critic.git"], "critic"],
                cwd=base_path)

            subprocess.check_output(
                ["git", "checkout", "--quiet", commit_sha1],
                cwd=repository_path)

            if os.path.isdir(os.path.join(repository_path,
                                          "installation/externals/v8-jsshell")):
                subprocess.check_output(
                    ["git", "submodule", "update", "--init",
                     "installation/externals/v8-jsshell"],
                    cwd=repository_path)
        except:
            shutil.rmtree(base_path)
            raise
        else:
            return Context(repository_path, shutil.rmtree, base_path)

    def is_running():
        try:
            output = subprocess.check_output(
                ["VBoxManage", "list", "runningvms"],
                stderr=subprocess.STDOUT)
        except subprocess.CalledProcessError:
            return True
        else:
            name = '"%s"' % arguments.instance
            uuid = '{%s}' % arguments.instance
            for line in output.splitlines():
                if name in line or uuid in line:
                    return True
            else:
                return False

    def start_process(repository_path, snapshot):
        argv_base = [sys.executable, "-u", "-m", "testing.main"]
        argv = argv_base[:]

        argv.extend(["--debug"])
        argv.extend(["--vm-identifier", arguments.instance])
        argv.extend(["--vm-hostname", actual["hostname"]])
        argv.extend(["--vm-snapshot", snapshot])

        if "ssh-port" in actual:
            argv.extend(["--vm-ssh-port", str(actual["ssh-port"])])
        if "http-port" in actual:
            argv.extend(["--vm-http-port", str(actual["http-port"])])
        if "git-daemon-port" in actual:
            argv.extend(["--git-daemon-port",
                         str(actual["git-daemon-port"])])

        key_tests = ["001-main/002-createrepository.py"]

        argv.extend(["--pause-after", key_tests[-1]])
        argv.extend(key_tests)

        logger.error("--- %s" % " ".join(argv))

        return subprocess.Popen(
            argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, cwd=repository_path)

    if is_running():
        logger.error("--- VM is busy!")
        while is_running():
            time.sleep(1)

    logger.error("---")
    logger.error("--- Time: %s" % datetime.datetime.now().strftime(
            "%Y-%m-%d %H:%M:%S"))
    logger.error("--- Commit: %s" % commit_sha1[:8])

    snapshot = configuration["custom-snapshot"]

    logger.error("--- Snapshot: %s" % snapshot)
    logger.error("---")

    with prepare_repositories() as repository_path:
        process = start_process(repository_path, snapshot)

        setnonblocking(process.stdout)
        setnonblocking(process.stderr)

        poll = select.poll()
        poll.register(process.stdout)
        poll.register(process.stderr)

        stdout_eof = False
        stderr_eof = False

        def interrupt():
            process.send_signal(signal.SIGINT)

        class BufferedLineReader(object):
            def __init__(self, source):
                self.source = source
                self.buffer = ""

            def readline(self):
                try:
                    while self.source is not None:
                        try:
                            line, self.buffer = self.buffer.split("\n", 1)
                        except ValueError:
                            pass
                        else:
                            return line + "\n"
                        data = self.source.read(1024)
                        if not data:
                            self.source = None
                            break
                        self.buffer += data
                    line = self.buffer
                    self.buffer = ""
                    return line
                except IOError as error:
                    if error.errno == errno.EAGAIN:
                        return None
                    raise

            def startswith(self, content):
                return self.buffer.startswith(content)

        stdout_reader = BufferedLineReader(process.stdout)
        stderr_reader = BufferedLineReader(process.stderr)

        up_reported = False

        while not (stdout_eof and stderr_eof):
            try:
                poll.poll(1000)

                with utils.locked_directory(configuration["queue-dir"]):
                    stop = False
                    if not os.path.exists(custom_filename):
                        stop = True
                    else:
                        with open(custom_filename, "r") as custom_file:
                            custom = json.load(custom_file)
                            stop = not custom["sha1"] or custom["id"] != custom_id
                    if stop:
                        logger.error("--- Custom test stopped...")
                        interrupt()
                        break

                if stdout_reader.startswith("Testing paused.  Press ENTER to continue:"):
                    if not up_reported:
                        critic.operation(
                            "CriticTester/custom",
                            data={ "id": custom_id,
                                   "command": "up" })
                        up_reported = True
                        logger.error("--- VM is up!")

                while not stdout_eof:
                    line = stdout_reader.readline()
                    if not line:
                        if line is not None:
                            poll.unregister(process.stdout)
                            stdout_eof = True
                        break
                    logger.error("1: %s" % line.rstrip("\n"))

                while not stderr_eof:
                    line = stderr_reader.readline()
                    if not line:
                        if line is not None:
                            poll.unregister(process.stderr)
                            stderr_eof = True
                        break
                    logger.error("2: %s" % line.rstrip("\n"))
            except KeyboardInterrupt:
                logger.error("--- Keyboard interrupt!")
                interrupt()

        process.wait()

        critic.operation(
            "CriticTester/custom",
            data={ "id": custom_id,
                   "command": "down" })

        logger.error("--- VM is down.")

incoming_dir = os.path.join(configuration["queue-dir"], "incoming")

try:
    while True:
        custom = None

        with utils.locked_directory(configuration["queue-dir"]):
            custom_filename = os.path.join(incoming_dir, "custom.json")

            if os.path.exists(custom_filename):
                with open(custom_filename, "r") as custom_file:
                    custom = json.load(custom_file)

        if custom and custom["sha1"]:
            run_test(custom["id"], custom["sha1"])
        else:
            time.sleep(1)
except KeyboardInterrupt:
    pass
