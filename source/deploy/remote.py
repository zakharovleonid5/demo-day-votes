"""Run deployment commands against the pinned Demo Day VPS."""
import argparse
import os
import sys
from pathlib import Path
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

parser = argparse.ArgumentParser()
parser.add_argument("--upload", nargs=2, metavar=("LOCAL", "REMOTE"))
args = parser.parse_args()
client = paramiko.SSHClient()
client.load_host_keys(str(Path.home() / ".ssh" / "demo_day_known_hosts"))
options = {"password": os.environ["DEPLOY_PASSWORD"]} if os.environ.get("DEPLOY_PASSWORD") else {"key_filename": str(Path.home() / ".ssh" / "demo_day_194_87_103_89")}
try:
    client.connect("194.87.103.89", username="root", look_for_keys=False, allow_agent=False, timeout=20, **options)
    if args.upload:
        with client.open_sftp() as sftp:
            sftp.put(*args.upload)
        print("Upload complete:", args.upload[1])
    else:
        channel = client.get_transport().open_session()
        channel.set_combine_stderr(True)
        channel.exec_command(sys.stdin.read())
        with channel.makefile("r") as output:
            for line in output:
                print(line.rstrip(), flush=True)
        sys.exit(channel.recv_exit_status())
finally:
    client.close()
