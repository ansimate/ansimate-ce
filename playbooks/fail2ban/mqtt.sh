#!/bin/bash

die() { echo "$*" >&2; exit 2; }  # complain to STDERR and exit with error
needs_arg() { if [ -z "$OPTARG" ]; then die "No arg for --$OPT option"; fi; }

MACHINE="$(hostname)"
ACTION=""
SERVICE=""
IP=""

while getopts dmc:-: OPT; do
  # support long options: https://stackoverflow.com/a/28466267/519360
  if [ "$OPT" = "-" ]; then   # long option: reformulate OPT and OPTARG
    OPT="${OPTARG%%=*}"       # extract long option name
    OPTARG="${OPTARG#$OPT}"   # extract long option argument (may be empty)
    OPTARG="${OPTARG#=}"      # if long option argument, remove assigning `=`
  fi
  case "$OPT" in
    a | action )   needs_arg; ACTION="$OPTARG" ;;
    s | service )  needs_arg; SERVICE="$OPTARG" ;;
    i | ip )       needs_arg; IP="$OPTARG" ;;
    ??* )          die "Illegal option --$OPT" ;;  # bad long option
    ? )            exit 2 ;;  # bad short option (error reported via getopts)
  esac
done

## check if env file exists
if [ ! -f __BASE_DIR__/config/fail2ban.env ]; then
  echo "cannot find enviromnent file for fail2ban.."
  exit 1
fi

## load env variables from config file
source __BASE_DIR__/config/fail2ban.env

# JSON-escape von extern beeinflussbaren Werten (verhindert JSON-Injection)
json_escape() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; printf '%s' "$s"; }
MACHINE="$(json_escape "$MACHINE")"
SERVICE="$(json_escape "$SERVICE")"
IP="$(json_escape "$IP")"

if [[ "$ACTION" == "start" ]]; then
  if [ ! -z "$MQTT_USERNAME" ]; then
    mosquitto_pub -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" -h "$MQTT_HOST" -p $MQTT_PORT -t "fail2ban" -m "{\"machine\":\"$MACHINE\",\"service\":\"fail2ban\",\"action\":\"started\"}"
  else
    mosquitto_pub -h "$MQTT_HOST" -p $MQTT_PORT -t "fail2ban" -m "{\"machine\":\"$MACHINE\",\"service\":\"fail2ban\",\"action\":\"started\"}"
  fi
elif [[ "$ACTION" == "stop" ]]; then
  if [ ! -z "$MQTT_USERNAME" ]; then
    mosquitto_pub -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" -h "$MQTT_HOST" -p $MQTT_PORT -t "fail2ban" -m "{\"machine\":\"$MACHINE\",\"service\":\"fail2ban\",\"action\":\"stopped\"}"
  else
    mosquitto_pub -h "$MQTT_HOST" -p $MQTT_PORT -t "fail2ban" -m "{\"machine\":\"$MACHINE\",\"service\":\"fail2ban\",\"action\":\"stopped\"}"
  fi
elif [[ "$ACTION" == "ban" ]]; then
  if [ ! -z "$MQTT_USERNAME" ]; then
    mosquitto_pub -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" -h "$MQTT_HOST" -p $MQTT_PORT -t "fail2ban/ban" -m "{\"machine\":\"$MACHINE\",\"service\":\"$SERVICE\",\"ip\":\"$IP\",\"action\":\"block\"}"
  else
    mosquitto_pub -h "$MQTT_HOST" -p $MQTT_PORT -t "fail2ban/ban" -m "{\"machine\":\"$MACHINE\",\"service\":\"$SERVICE\",\"ip\":\"$IP\",\"action\":\"block\"}"
  fi
elif [[ "$ACTION" == "unban" ]]; then
  if [ ! -z "$MQTT_USERNAME" ]; then
    mosquitto_pub -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" -h "$MQTT_HOST" -p $MQTT_PORT -t "fail2ban/unban" -m "{\"machine\":\"$MACHINE\",\"service\":\"$SERVICE\",\"ip\":\"$IP\",\"action\":\"free\"}"
  else
    mosquitto_pub -h "$MQTT_HOST" -p $MQTT_PORT -t "fail2ban/unban" -m "{\"machine\":\"$MACHINE\",\"service\":\"$SERVICE\",\"ip\":\"$IP\",\"action\":\"free\"}"
  fi
fi