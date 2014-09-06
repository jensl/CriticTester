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
import contextlib

import utils

USE_PASSLIB_SHA1 = "5d545b0b957b4c942a01ca9f0133547eafcf8f96"
APACHE_2_4_SHA1 = "2a254e94a3167d856617dc6219ac60442a340eef"

configuration = json.load(open("configuration.json"))
instances = json.load(open("instances.json"))

parser = argparse.ArgumentParser("CriticTester: test runner")
parser.add_argument("--instance", help="Instance to test in", required=True)

arguments = parser.parse_args()

activity_timeout = configuration["activity-timeout"]
overall_timeout = configuration["overall-timeout"]

logging.basicConfig(format="%(message)s", stream=sys.stdout)
logger = logging.getLogger("runner")

logger.addHandler(
    logging.handlers.RotatingFileHandler(
        os.path.join(configuration["log-dir"], arguments.instance),
        maxBytes=2**20, backupCount=10))

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

if instance.get("type") not in ("local", "quickstart"):
    semaphore = utils.Semaphore(
        configuration["semaphore-dir"], configuration["max-instances"], actual["identifier"])
else:
    class Semaphore(object):
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
    semaphore = Semaphore()

def describe_instance():
    if "type" in instance:
        return "--" + instance["type"]
    elif instance["identifier"] != actual["identifier"]:
        return "%s (%s)" % (instance["identifier"], actual["identifier"])
    else:
        return instance["identifier"]

logger.error("---")
logger.error("--- Instance: " + describe_instance())
logger.error("---")

@contextlib.contextmanager
def Context(value, callback, *args):
    try:
        yield value
    finally:
        try:
            callback(*args)
        except Exception:
            traceback.print_exc()

def setnonblocking(fd):
    fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) | os.O_NONBLOCK)

critic = utils.Critic()

def signal_running(filename=None, test=None):
    data = { "runner_id": actual["identifier"] }
    if filename and test:
        review_id = int(filename.partition(":")[0])
        data.update({ "instance_id": instance["identifier"],
                      "review_id": review_id,
                      "commit": test["commit"],
                      "upgrade_from": test.get("upgrade_from") })
    critic.operation("CriticTester/running", data=data)

def run_test(filename, test):
    start = time.time()

    commit_sha1 = subprocess.check_output(
        ["git", "rev-parse", "--verify", "--quiet", test["commit"]],
        cwd=configuration["critic.git"]).strip()

    if test.get("upgrade_from"):
        upgrade_from_sha1 = subprocess.check_output(
            ["git", "rev-parse", "--verify", "--quiet", test["upgrade_from"]],
            cwd=configuration["critic.git"]).strip()
    else:
        upgrade_from_sha1 = None

    parents = test.get("parents")

    if parents and len(parents) == 1:
        reference_sha1 = subprocess.check_output(
            ["git", "rev-parse", "--verify", "--quiet", parents[0]],
            cwd=configuration["critic.git"]).strip()
    elif upgrade_from_sha1:
        reference_sha1 = upgrade_from_sha1
    else:
        reference_sha1 = subprocess.check_output(
            ["git", "rev-parse", "--verify", "--quiet", "%s^" % commit_sha1],
            cwd=configuration["critic.git"]).strip()

    def select_snapshot():
        changed_files = subprocess.check_output(
            ["git", "diff", "--name-only",
             "%s..%s" % (reference_sha1, commit_sha1)],
            cwd=configuration["critic.git"]).splitlines()

        snapshot = None

        for changed_file in changed_files:
            if changed_file in ("install.py",
                                "upgrade.py",
                                "extend.py",
                                "installation/__init__.py",
                                "installation/input.py",
                                "installation/process.py",
                                "installation/prereqs.py"):
                # Changes that (may) affect dependency installation are
                # tested using the "clean" snapshot.
                snapshot = "clean"
                break
            elif changed_file.startswith("resources/") \
                    or changed_file.startswith("src/resources/"):
                # Static resources don't affect testing (unfortunately) so
                # no point in testing commits only changing them.
                continue
            elif upgrade_from_sha1 and (
                changed_file.startswith("tutorials/") and
                changed_file.endswith(".txt")):
                # Changes to tutorials are tested using the "with-prereqs"
                # snapshot, and not tested at all with upgrading at all.
                if upgrade_from_sha1:
                    continue
                snapshot = "with-prereqs"
            else:
                # Other changes are tested using the "with-prereqs" snapshot,
                # and both with upgrading and not.
                snapshot = "with-prereqs"

        return snapshot

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

            if instance["test-extensions"]:
                v8jsshell_path = os.path.join(
                    repository_path, "installation/externals/v8-jsshell")
                if os.path.isdir(v8jsshell_path):
                    subprocess.check_output(
                        ["git", "submodule", "update", "--init",
                         "installation/externals/v8-jsshell"],
                        cwd=repository_path)
                    if "v8.git" in configuration:
                        subprocess.check_call(
                            ["git", "submodule", "init", "v8"],
                            cwd=v8jsshell_path)
                        subprocess.check_call(
                            ["git", "config", "submodule.v8.url",
                             configuration["v8.git"]],
                            cwd=v8jsshell_path)
                        subprocess.check_output(
                            ["git", "submodule", "update", "v8"],
                            cwd=v8jsshell_path)
        except:
            shutil.rmtree(base_path)
            raise
        else:
            return Context(repository_path, shutil.rmtree, base_path)

    def is_running():
        if instance.get("type") in ("local", "quickstart"):
            return False
        try:
            output = subprocess.check_output(
                ["VBoxManage", "list", "runningvms"],
                stderr=subprocess.STDOUT)
        except subprocess.CalledProcessError:
            return True
        else:
            name = '"%s"' % actual["identifier"]
            uuid = '{%s}' % actual["identifier"]
            for line in output.splitlines():
                if name in line or uuid in line:
                    return True
            else:
                return False

    class NotSupported(Exception):
        pass

    def start_process(repository_path, snapshot):
        argv_base = [sys.executable, "-u", "-m", "testing"]
        argv = argv_base[:]

        if test["type"] == "coverage":
            argv.extend(["--coverage"])
        else:
            argv.extend(["--debug"])

        help_output = subprocess.check_output(
            argv_base + ["--help"], cwd=repository_path).splitlines()

        if instance.get("type") == "local":
            for line in help_output:
                if line.strip().startswith("--local"):
                    break
            else:
                raise NotSupported("--local not supported")

            argv.append("--local")
        elif instance.get("type") == "quickstart":
            for line in help_output:
                if line.strip().startswith("--quickstart"):
                    break
            else:
                raise NotSupported("--quickstart not supported")

            argv.append("--quickstart")
        else:
            argv.extend(["--vm-identifier", actual["identifier"]])
            argv.extend(["--vm-hostname", actual["hostname"]])
            argv.extend(["--vm-snapshot", snapshot])

            if "ssh-port" in actual:
                argv.extend(["--vm-ssh-port", str(actual["ssh-port"])])
            if "http-port" in actual:
                argv.extend(["--vm-http-port", str(actual["http-port"])])
            if "git-daemon-port" in actual:
                argv.extend(["--git-daemon-port",
                             str(actual["git-daemon-port"])])

            supports_test_extensions = False
            supports_strict_fs_permissions = False

            for line in help_output:
                line = line.strip()
                if line.startswith("--test-extensions"):
                    supports_test_extensions = True
                elif line.startswith("--strict-fs-permissions"):
                    supports_strict_fs_permissions = True

            if supports_test_extensions and instance.get("test-extensions", False):
                argv.extend(["--cache-dir", configuration["cache-dir"],
                             "--test-extensions"])

            if supports_strict_fs_permissions:
                argv.append("--strict-fs-permissions")

        if upgrade_from_sha1:
            argv.extend(["--upgrade-from", upgrade_from_sha1])

        logger.error("--- %s" % " ".join(argv))

        return subprocess.Popen(
            argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=repository_path)

    def finish(**kwargs):
        result = { "description": instance["description"],
                   "elapsed": time.time() - start }
        for key in ("success", "message", "stdout", "stderr"):
            result[key] = kwargs.get(key)
        data = test.copy()
        data["result"] = { instance["identifier"]: result }
        return data

    if is_running():
        logger.error("--- VM is busy!")

        time.sleep(3)

        if is_running():
            logger.error("--- Attempting to power off ...")

            subprocess.check_call(["VBoxManage", "controlvm",
                                   actual["identifier"], "poweroff"])

        while is_running():
            time.sleep(1)

    logger.error("---")
    logger.error("--- Time: %s" % datetime.datetime.now().strftime(
            "%Y-%m-%d %H:%M:%S"))
    logger.error("--- Commit: %s %s"
                 % (commit_sha1[:8], test["commit_title"]))
    if upgrade_from_sha1:
        logger.error("--- Upgrade from: %s %s"
                     % (upgrade_from_sha1[:8], test["upgrade_from_title"]))
    logger.error("--- Type: %s" % test["type"])

    if instance["identifier"] == "debian7":
        if upgrade_from_sha1:
            install_sha1 = upgrade_from_sha1
        else:
            install_sha1 = commit_sha1

        try:
            subprocess.check_call(
                ["git", "merge-base", "--is-ancestor", USE_PASSLIB_SHA1,
                 install_sha1],
                cwd=configuration["critic.git"])
        except subprocess.CalledProcessError:
            uses_passlib = False
        else:
            uses_passlib = True

        if not uses_passlib:
            logger.error("--- Not supported (depends on python-bcrypt)")
            logger.error("---")
            return finish(success=True, message="debian7 not supported")
    elif instance["identifier"] == "ubuntu1310":
        if upgrade_from_sha1:
            install_sha1 = upgrade_from_sha1
        else:
            install_sha1 = commit_sha1

        try:
            subprocess.check_call(
                ["git", "merge-base", "--is-ancestor", APACHE_2_4_SHA1,
                 install_sha1],
                cwd=configuration["critic.git"])
        except subprocess.CalledProcessError:
            supports_apache_2_4 = False
        else:
            supports_apache_2_4 = True

        if not supports_apache_2_4:
            logger.error("--- Not supported (Apache 2.4)")
            logger.error("---")
            return finish(success=True, message="ubuntu1310 not supported")

    if instance.get("type") in ("local", "quickstart"):
        snapshot = None
    elif test["type"] == "coverage":
        supports_coverage = subprocess.check_output(
            ["git", "ls-tree", commit_sha1, "src/coverage.py"],
            cwd=configuration["critic.git"]).strip()

        if not supports_coverage:
            logger.error("--- Not supported")
            logger.error("---")
            return finish(success=True, message="coverage not supported")

        snapshot = "with-prereqs"
    else:
        snapshot = select_snapshot()

        if snapshot is None:
            logger.error("--- Skipped")
            logger.error("---")
            return finish(success=True, message="not tested")

    if snapshot is not None:
        logger.error("--- Snapshot: %s" % snapshot)

    logger.error("---")

    with semaphore, prepare_repositories() as repository_path:
        try:
            process = start_process(repository_path, snapshot)
        except NotSupported as error:
            logger.error("--- Not supported")
            logger.error("---")
            return finish(success=True, message=error.message)

        setnonblocking(process.stdout)
        setnonblocking(process.stderr)

        poll = select.poll()
        poll.register(process.stdout)
        poll.register(process.stderr)

        stdout = cStringIO.StringIO()
        stderr = cStringIO.StringIO()
        stdout_eof = False
        stderr_eof = False

        interrupted = [False]
        timeout_activity = False
        timeout_overall = False
        terminated = False
        killed = False
        aborted = False
        obsoleted = False

        activity_deadline = [0]
        overall_deadline = [0]

        def set_activity_deadline(timeout=activity_timeout):
            activity_deadline[0] = time.time() + timeout
        def set_overall_deadline():
            overall_deadline[0] = time.time() + overall_timeout

        set_activity_deadline()
        set_overall_deadline()

        def interrupt():
            process.send_signal(signal.SIGINT)
            interrupted[0] = True
            set_activity_deadline(timeout=30)
            overall_deadline[0] = None

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

        stdout_reader = BufferedLineReader(process.stdout)
        stderr_reader = BufferedLineReader(process.stderr)

        while not (stdout_eof and stderr_eof):
            now = time.time()

            if not (timeout_activity or timeout_overall):
                if now > activity_deadline[0]:
                    timeout_activity = True
                elif now > overall_deadline[0]:
                    timeout_overall = True

            if now > activity_deadline[0] or (overall_deadline[0] and now > overall_deadline[0]):
                if terminated:
                    process.kill()
                    killed = True
                elif interrupted[0]:
                    process.terminate()
                    terminated = True
                    set_activity_deadline()
                else:
                    interrupt()

            try:
                if overall_deadline[0]:
                    deadline = min(activity_deadline[0], overall_deadline[0])
                else:
                    deadline = activity_deadline[0]

                events = poll.poll(min(10, deadline - time.time()))

                if filename:
                    incoming_filename = os.path.join(incoming_dir, filename)
                    if not os.path.isfile(incoming_filename):
                        logger.info("--- Test aborted!")
                        interrupt()
                        filename = None
                        obsoleted = True

                if not events:
                    continue

                while not stdout_eof:
                    line = stdout_reader.readline()
                    if line is None:
                        break
                    set_activity_deadline()
                    if not line:
                        poll.unregister(process.stdout)
                        stdout_eof = True
                    else:
                        stdout.write(line)
                        if test["type"] != "coverage":
                            logger.error("1: %s" % line.rstrip("\n"))

                while not stderr_eof:
                    line = stderr_reader.readline()
                    if line is None:
                        break
                    set_activity_deadline()
                    if not line:
                        poll.unregister(process.stderr)
                        stderr_eof = True
                    else:
                        stderr.write(line)
                        logger.error("2: %s" % line.rstrip("\n"))
            except KeyboardInterrupt:
                logger.error("--- Keyboard interrupt!")
                interrupt()
                aborted = True

        process.wait()

    if timeout_activity or timeout_overall:
        success = False

        if timeout_activity:
            message = "timeout: activity [%d seconds]" % activity_timeout
        else:
            message = "timeout: overall[ [%d seconds]" % overall_timeout

        if killed:
            message += " (process interrupted, terminated and killed)"
        elif terminated:
            message += " (process interrupted and terminated)"
        else:
            message += " (process interrupted)"
    elif interrupted[0]:
        success = False
        message = "testing interrupted"
    elif process.returncode != 0:
        success = False
        if process.returncode > 0:
            message = "process exited with status %d" % process.returncode
        else:
            message = "process terminated by signal %d" % -process.returncode
    else:
        success = True
        message = None

    if aborted:
        raise KeyboardInterrupt
    elif obsoleted:
        return None

    stdout_lines = stdout.getvalue().splitlines()

    if instance.get("type") == "local":
        for line in stdout_lines:
            if line.endswith("No tests selected!"):
                logger.error("--- Not supported")
                logger.error("---")
                return finish(success=True, message="--local not supported")

    for line in stdout_lines:
        if line.endswith(
            "ChangesetBackgroundServiceError: Changeset background "
            "service failed: No such file or directory"):
            return False
        if line.endswith("ZeroDivisionError: float division by zero"):
            return False

    return finish(success=success,
                  message=message,
                  stdout=stdout.getvalue(),
                  stderr=stderr.getvalue())

incoming_dir = os.path.join(configuration["queue-dir"], "incoming")
outgoing_dir = os.path.join(configuration["queue-dir"], "outgoing")

def is_testable(filename):
    if not filename.endswith(":%s.json" % instance["identifier"]):
        return False
    testing_filename = os.path.join(incoming_dir, filename + ".testing")
    if os.path.isfile(testing_filename):
        with open(testing_filename) as testing_file:
            if testing_file.read().strip() == actual["identifier"]:
                logger.warning("Removing stale file: %s"
                               % (filename + ".testing"))
                os.unlink(testing_filename)
            else:
                return False
    return True

try:
    is_running = False

    while True:
        with utils.locked_directory(configuration["queue-dir"]):
            filenames = [filename for filename in os.listdir(incoming_dir)
                         if is_testable(filename)]

            if filenames:
                filename = sorted(filenames)[0]
                incoming_filename = os.path.join(incoming_dir, filename)
                with open(incoming_filename) as incoming_file:
                    test = json.load(incoming_file)
                with open(incoming_filename + ".testing", "w") as testing_file:
                    print >>testing_file, actual["identifier"]
            else:
                test = None

        if test:
            signal_running(filename, test)
            is_running = True

            data = run_test(filename, test)

            with utils.locked_directory(configuration["queue-dir"]):
                if data and os.path.isfile(incoming_filename):
                    outgoing_filename = os.path.join(outgoing_dir, filename)
                    with open(outgoing_filename, "w") as outgoing_file:
                        json.dump(data, outgoing_file)
                    os.unlink(incoming_filename)
                os.unlink(incoming_filename + ".testing")
        else:
            if is_running:
                signal_running()
                is_running = False

            time.sleep(1)
except KeyboardInterrupt:
    pass
