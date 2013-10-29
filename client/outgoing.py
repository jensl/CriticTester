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
        data = {}

        with utils.locked_directory(configuration["queue-dir"]):
            filenames = [filename for filename in os.listdir(outgoing_dir)
                         if filename.endswith(".json")]

            for filename in filenames:
                outgoing_filename = os.path.join(outgoing_dir, filename)
                with open(outgoing_filename) as outgoing_file:
                    new_test = json.load(outgoing_file)
                review_id = filename.partition(":")[0]
                if review_id not in data:
                    data[review_id] = []
                for test in data[review_id]:
                    if test["key"] == new_test["key"]:
                        for instance_id, instance_data in new_test["result"].data():
                            test["result"][instance_id] = instance_data
                        break
                else:
                    data[review_id].append(new_test)

        if data:
            logger.debug("Submitting results...")

            critic.operation("CriticTester/submit", data=data)

            with utils.locked_directory(configuration["queue-dir"]):
                for filename in filenames:
                    os.unlink(os.path.join(outgoing_dir, filename))
                    logger.debug("Deleted: %s" % filename)

        time.sleep(1)
except KeyboardInterrupt:
    pass
