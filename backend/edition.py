# Active product edition: "cloud", "onpremise" or "community".
#
# This file is regenerated at BUILD TIME by the Docker build from the EDITION build
# argument (see backend/Dockerfile -> `ARG EDITION` + `RUN echo ... > edition.py`).
# As a result, the edition is baked firmly into the container and can NO LONGER be
# changed at RUNTIME via environment variables.
#
# The value checked in here is only the default for local development/tests and
# for builds without a build argument (default: "cloud").
EDITION = "community"
