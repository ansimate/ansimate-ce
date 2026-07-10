#!/usr/bin/env python3
import os
import sys
import json
import argparse
import urllib.request
import urllib.error
import uuid

def get_config(args):
    url = (args.url or os.environ.get("ANSIMATE_URL", "http://ansimate.eu")).rstrip('/')
    token = args.token or os.environ.get("ANSIMATE_API_TOKEN")
    if not token:
        print("Error: API Token is required. Set ANSIMATE_API_TOKEN environment variable or pass --token.", file=sys.stderr)
        sys.exit(1)
    return url, token

def make_request(url, path, method="GET", data=None, headers=None, token=None):
    full_url = f"{url}{path}"
    headers = headers or {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    req_data = None
    if data is not None:
        if isinstance(data, (dict, list)):
            req_data = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif isinstance(data, bytes):
            req_data = data
    
    req = urllib.request.Request(full_url, data=req_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            res_data = response.read()
            content_type = response.headers.get("Content-Type", "")
            if "application/json" in content_type:
                return json.loads(res_data.decode("utf-8"))
            return res_data.decode("utf-8")
    except urllib.error.HTTPError as e:
        err_data = e.read().decode("utf-8")
        try:
            err_json = json.loads(err_data)
            print(f"Error ({e.code}): {json.dumps(err_json, indent=2)}", file=sys.stderr)
        except Exception:
            print(f"Error ({e.code}): {err_data}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Connection failed: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_version(args):
    url, token = get_config(args)
    res = make_request(url, "/api/version", "GET", token=token)
    print(json.dumps(res, indent=2))

def cmd_list_devices(args):
    url, token = get_config(args)
    res = make_request(url, "/api/devices", "GET", token=token)
    print(json.dumps(res, indent=2))

def cmd_create_device(args):
    url, token = get_config(args)
    payload = {
        "name": args.name,
        "host": args.host,
        "username": args.username,
        "port": args.port,
        "credential": args.credential,
        "credential_type": args.credential_type
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    res = make_request(url, "/api/devices", "POST", data=payload, token=token)
    print(json.dumps(res, indent=2))

def cmd_delete_device(args):
    url, token = get_config(args)
    res = make_request(url, f"/api/devices/{args.id}", "DELETE", token=token)
    print(json.dumps(res, indent=2))

def cmd_list_playbooks(args):
    url, token = get_config(args)
    res = make_request(url, "/api/playbooks", "GET", token=token)
    print(json.dumps(res, indent=2))

def cmd_upload_playbook(args):
    url, token = get_config(args)
    
    # 1. Edition Check
    ver_info = make_request(url, "/api/version", "GET", token=token)
    edition = ver_info.get("edition", "")
    if edition == "community":
        print("Error: Playbook upload is not supported in the Community Edition.", file=sys.stderr)
        sys.exit(1)
        
    # 2. Subscription Tier Check (if SaaS/Commercial)
    profile = make_request(url, "/api/profile", "GET", token=token)
    tier = profile.get("abo_tier") or profile.get("tier")
    if tier and str(tier).lower() == "free":
        print("Error: Custom playbook uploads are not allowed on the Free tier. Please upgrade to a Premium tier.", file=sys.stderr)
        sys.exit(1)
        
    # 3. Duplicate Check
    playbooks = make_request(url, "/api/playbooks", "GET", token=token)
    playbooks_list = []
    if isinstance(playbooks, list):
        playbooks_list = playbooks
    elif isinstance(playbooks, dict):
        for val in playbooks.values():
            if isinstance(val, list):
                playbooks_list = val
                break
                
    filename = os.path.basename(args.file)
    for p in playbooks_list:
        if isinstance(p, dict):
            p_name = p.get("name", "")
            p_file = p.get("filename", "")
            if p_name.lower() == args.name.lower() or p_file.lower() == filename.lower():
                print(f"Error: A playbook with name '{args.name}' or filename '{filename}' already exists on the server.", file=sys.stderr)
                sys.exit(1)
                
    # 4. Perform Upload
    if not os.path.exists(args.file):
        print(f"Error: File {args.file} does not exist.", file=sys.stderr)
        sys.exit(1)
        
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    
    with open(args.file, "rb") as f:
        file_content = f.read()
        
    parts = []
    
    # File Part
    parts.append(f'--{boundary}'.encode('utf-8'))
    parts.append(f'Content-Disposition: form-data; name="file"; filename="{filename}"'.encode('utf-8'))
    parts.append(b'Content-Type: application/octet-stream')
    parts.append(b'')
    parts.append(file_content)
    
    # Name Part
    if args.name:
        parts.append(f'--{boundary}'.encode('utf-8'))
        parts.append(f'Content-Disposition: form-data; name="name"'.encode('utf-8'))
        parts.append(b'')
        parts.append(args.name.encode('utf-8'))
        
    # Description Part
    if args.desc:
        parts.append(f'--{boundary}'.encode('utf-8'))
        parts.append(f'Content-Disposition: form-data; name="description"'.encode('utf-8'))
        parts.append(b'')
        parts.append(args.desc.encode('utf-8'))
        
    parts.append(f'--{boundary}--'.encode('utf-8'))
    parts.append(b'')
    
    body = b'\r\n'.join(parts)
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    
    res = make_request(url, "/api/playbooks/upload", "POST", data=body, headers=headers, token=token)
    print(json.dumps(res, indent=2))

def cmd_delete_playbook(args):
    url, token = get_config(args)
    res = make_request(url, f"/api/playbooks/custom/{args.filename}", "DELETE", token=token)
    print(json.dumps(res, indent=2))

def cmd_list_scenarios(args):
    url, token = get_config(args)
    res = make_request(url, "/api/profile/scenarios", "GET", token=token)
    print(json.dumps(res, indent=2))

def cmd_create_scenario(args):
    url, token = get_config(args)
    payload = {
        "name": args.name,
        "preset_id": args.preset_id,
        "device_group_id": args.device_group_id
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    res = make_request(url, "/api/profile/scenarios", "POST", data=payload, token=token)
    print(json.dumps(res, indent=2))

def cmd_delete_scenario(args):
    url, token = get_config(args)
    res = make_request(url, f"/api/profile/scenarios/{args.id}", "DELETE", token=token)
    print(json.dumps(res, indent=2))

def cmd_run(args):
    url, token = get_config(args)
    
    playbooks = [args.playbook] if args.playbook else []
    if not playbooks and not args.scenario_id:
        print("Error: Either --playbook or --scenario-id must be specified.", file=sys.stderr)
        sys.exit(1)
        
    variables = None
    if args.vars:
        try:
            variables = json.loads(args.vars)
        except Exception as e:
            print(f"Error: Invalid JSON string for --vars. Detail: {e}", file=sys.stderr)
            sys.exit(1)

    payload = {
        "playbooks": playbooks,
        "target_host": args.host,
        "username": args.username,
        "password": args.password,
        "device_id": args.device_id,
        "scenario_id": args.scenario_id,
        "variables": variables
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    
    res = make_request(url, "/api/run", "POST", data=payload, token=token)
    print(json.dumps(res, indent=2))

def cmd_list_jobs(args):
    url, token = get_config(args)
    res = make_request(url, "/api/jobs", "GET", token=token)
    print(json.dumps(res, indent=2))

def cmd_job_logs(args):
    url, token = get_config(args)
    res = make_request(url, f"/api/jobs/{args.job_id}/logs", "GET", token=token)
    if isinstance(res, (dict, list)):
        print(json.dumps(res, indent=2))
    else:
        print(res)

def cmd_cancel_job(args):
    url, token = get_config(args)
    res = make_request(url, f"/api/jobs/{args.job_id}/cancel", "POST", token=token)
    print(json.dumps(res, indent=2))

def main():
    parser = argparse.ArgumentParser(description="Ansimate CLI Client")
    parser.add_argument("--url", help="Ansimate URL (default: env ANSIMATE_URL or http://ansimate.eu)")
    parser.add_argument("--token", help="Ansimate API Token (default: env ANSIMATE_API_TOKEN)")
    
    subparsers = parser.add_subparsers(dest="command", required=True, help="Subcommands")
    
    # version
    subparsers.add_parser("version", help="Get Ansimate server edition/version")
    
    # list-devices
    subparsers.add_parser("list-devices", help="List registered devices")
    
    # create-device
    p_cdev = subparsers.add_parser("create-device", help="Create a device")
    p_cdev.add_argument("--name", required=True, help="Device name")
    p_cdev.add_argument("--host", required=True, help="Host IP/Domain")
    p_cdev.add_argument("--username", help="SSH username")
    p_cdev.add_argument("--port", type=int, default=22, help="SSH port")
    p_cdev.add_argument("--credential", help="SSH password or private key")
    p_cdev.add_argument("--credential-type", choices=["password", "key"], help="Type of credential")
    
    # delete-device
    p_ddev = subparsers.add_parser("delete-device", help="Delete a device")
    p_ddev.add_argument("--id", required=True, help="Device ID")
    
    # list-playbooks
    subparsers.add_parser("list-playbooks", help="List playbooks")
    
    # upload-playbook
    p_upb = subparsers.add_parser("upload-playbook", help="Upload a playbook (.yml / .yaml)")
    p_upb.add_argument("--file", required=True, help="Local playbook file path")
    p_upb.add_argument("--name", required=True, help="Playbook name")
    p_upb.add_argument("--desc", help="Playbook description")
    
    # delete-playbook
    p_dpb = subparsers.add_parser("delete-playbook", help="Delete a custom playbook")
    p_dpb.add_argument("--filename", required=True, help="Playbook file name to delete")
    
    # list-scenarios
    subparsers.add_parser("list-scenarios", help="List scenarios")
    
    # create-scenario
    p_csen = subparsers.add_parser("create-scenario", help="Create a scenario")
    p_csen.add_argument("--name", required=True, help="Scenario name")
    p_csen.add_argument("--preset-id", required=True, help="Preset ID")
    p_csen.add_argument("--device-group-id", help="Device group ID")
    
    # delete-scenario
    p_dsen = subparsers.add_parser("delete-scenario", help="Delete a scenario")
    p_dsen.add_argument("--id", required=True, help="Scenario ID")
    
    # run
    p_run = subparsers.add_parser("run", help="Run a playbook or scenario")
    p_run.add_argument("--playbook", help="Playbook name or filename (optional if running a scenario)")
    p_run.add_argument("--host", help="Target host (if not using device-id)")
    p_run.add_argument("--username", help="Host SSH username")
    p_run.add_argument("--password", help="Host SSH password")
    p_run.add_argument("--device-id", help="Device ID to run on")
    p_run.add_argument("--scenario-id", help="Scenario ID to run")
    p_run.add_argument("--vars", help="Variables as JSON string (e.g. '{\"port\":80}')")
    
    # jobs
    subparsers.add_parser("jobs", help="List jobs")
    
    # job-logs
    p_logs = subparsers.add_parser("job-logs", help="Get job logs")
    p_logs.add_argument("--job-id", required=True, help="Job ID")
    
    # cancel-job
    p_cancel = subparsers.add_parser("cancel-job", help="Cancel a job")
    p_cancel.add_argument("--job-id", required=True, help="Job ID")
    
    args = parser.parse_args()
    
    commands = {
        "version": cmd_version,
        "list-devices": cmd_list_devices,
        "create-device": cmd_create_device,
        "delete-device": cmd_delete_device,
        "list-playbooks": cmd_list_playbooks,
        "upload-playbook": cmd_upload_playbook,
        "delete-playbook": cmd_delete_playbook,
        "list-scenarios": cmd_list_scenarios,
        "create-scenario": cmd_create_scenario,
        "delete-scenario": cmd_delete_scenario,
        "run": cmd_run,
        "jobs": cmd_list_jobs,
        "job-logs": cmd_job_logs,
        "cancel-job": cmd_cancel_job
    }
    
    commands[args.command](args)

if __name__ == "__main__":
    main()
