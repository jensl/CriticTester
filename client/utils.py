import sys
import os
import fcntl
import requests
import logging
import time
import json
import glob

configuration = json.load(open("configuration.json"))
instances = json.load(open("instances.json"))

logger = None

def set_safe_locale():
    """Make sure we have a safe and unproblematic locale setting"""

    for name in os.environ.keys():
        if name.startswith("LC_"):
            del os.environ[name]

    if "LANGUAGE" in os.environ:
        del os.environ["LANGUAGE"]

    os.environ["LANG"] = "C"

def configure_logging():
    global logger

    logging.basicConfig(format="%(asctime)-15s | %(levelname)-7s | %(message)s",
                        stream=sys.stdout)

    logger = logging.getLogger("critic")
    logger.setLevel(logging.DEBUG)

    return logger

def locked_directory(path):
    class LockFile(object):
        def __init__(self, filename):
            self.filename = filename
            self.lock_file = open(filename, "w")
            fcntl.flock(self.lock_file, fcntl.LOCK_EX)
            self.lock_file.write("%d\n" % os.getpid())
        def __enter__(self):
            return self
        def __exit__(self, *args):
            self.lock_file.close()
            return False

    return LockFile(os.path.join(path, ".lock"))

class Semaphore(object):
    def __init__(self, path, limit, name):
        self.path = path
        self.limit = limit
        self.name = name

    def __enter__(self):
        pid_filename = os.path.join(self.path, self.name + ".pid")
        while True:
            with locked_directory(self.path):
                if os.path.exists(pid_filename):
                    raise Exception("Am I already running?!?")
                count = len(glob.glob(os.path.join(self.path, "*.pid")))
                if count < self.limit:
                    with open(pid_filename, "w") as pid_file:
                        print >>pid_file, str(os.getpid())
                    break
            time.sleep(0.1)
        return self

    def __exit__(self, *args):
        pid_filename = os.path.join(self.path, self.name + ".pid")
        if os.path.exists(pid_filename):
            os.unlink(pid_filename)

class Critic(object):
    def __init__(self):
        self.session = None
        configure_logging()

    def initialize(self):
        while True:
            try:
                self.session = requests.Session()
                self.session.post(
                    "%s/validatelogin" % configuration["critic-url"],
                    data=json.dumps(
                        { "username": configuration["critic-username"],
                          "password": configuration["critic-password"] }))
            except Exception:
                logger.exception("login failed")
                time.sleep(1)
            else:
                break

    def operation(self, path, data):
        while True:
            if self.session is None:
                self.initialize()
            try:
                response = self.session.post(
                    "%s/%s" % (configuration["critic-url"], path),
                    data=json.dumps(data))
                if response.status_code == 500:
                    logger.error("Operation failed:\n" + response.text)
                response.raise_for_status()
                return response.json()
            except Exception:
                self.reset()
                logger.exception("operation failed")
                time.sleep(1)

    def reset(self):
        self.session = None
