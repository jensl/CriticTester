import sys
import os
import logging
import time
import json
import fcntl
import subprocess

import utils

logger = utils.configure_logging()
logger.info("Outgoing")

configuration = json.load(open("configuration.json"))
instances = json.load(open("instances.json"))

critic = utils.Critic()

outgoing_dir = os.path.join(configuration["queue-dir"], "outgoing")

try:
    while True:
        with utils.locked_directory(configuration["queue-dir"]):
            filenames = [filename for filename in os.listdir(outgoing_dir)
                         if filename.endswith(".json")]

        if filenames:
            filename = filenames.pop(0)

            outgoing_filename = os.path.join(outgoing_dir, filename)
            with open(outgoing_filename) as outgoing_file:
                new_test = json.load(outgoing_file)
            review_id = filename.partition(":")[0]

            critic.operation("CriticTester/submit",
                             data={ review_id: [new_test] })

            with utils.locked_directory(configuration["queue-dir"]):
                os.unlink(os.path.join(outgoing_dir, filename))

            logger.debug("Submitted: %s" % filename)

        time.sleep(1)
except KeyboardInterrupt:
    pass
