# Aktive Produkt-Edition: "cloud", "onpremise" oder "community".
#
# Diese Datei wird zur BUILD-ZEIT vom Docker-Build aus dem Build-Argument EDITION
# neu erzeugt (siehe backend/Dockerfile -> `ARG EDITION` + `RUN echo ... > edition.py`).
# Dadurch ist die Edition fest in den Container eingebacken und kann zur LAUFZEIT
# NICHT mehr ueber Umgebungsvariablen geaendert werden.
#
# Der hier eingecheckte Wert ist nur der Default fuer lokale Entwicklung/Tests und
# fuer Builds ohne Build-Argument (Standard: "cloud").
EDITION = "community"
