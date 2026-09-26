"""On the production Mac, assert that launchd owns the healthy API process."""

import json
import os
import re
import subprocess
import urllib.request

service = subprocess.check_output(['launchctl', 'print', f'gui/{os.getuid()}/com.resume-agent.app'], text=True)
pid = re.search(r'^\s*pid = (\d+)$', service, re.MULTILINE)
assert pid, 'App LaunchAgent is not running'
listeners = subprocess.check_output(['lsof', '-nP', '-t', '-iTCP:8000', '-sTCP:LISTEN'], text=True).split()
assert listeners == [pid.group(1)], 'API listener is orphaned or belongs to a different service'
with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:8000/health', timeout=5) as response:
    assert response.status == 200 and json.load(response) == {'status': 'ok'}
print('LaunchAgent owns the healthy API process.')
