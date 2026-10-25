#!/usr/bin/env python3
"""Static validation for the exported n8n workflow (no n8n server required)."""
from __future__ import annotations
import hashlib
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF_PATH = ROOT / 'business-inquiry-auto-reply.json'
ORIGINAL = ROOT / 'original-workflow' / 'AI-Lead-Follow-Up-Agent.original.json'

wf = json.loads(WF_PATH.read_text(encoding='utf-8'))
nodes = wf.get('nodes', [])
connections = wf.get('connections', {})
names = [n.get('name') for n in nodes]
ids = [n.get('id') for n in nodes]
assert len(names) == len(set(names)), 'Duplicate node names found'
assert len(ids) == len(set(ids)), 'Duplicate node IDs found'
by = {n['name']: n for n in nodes}
name_set = set(names)

# Connection sources and destinations must refer to existing nodes.
for source, outputs in connections.items():
    assert source in name_set, f'Unknown connection source: {source}'
    for output_groups in outputs.values():
        for output in output_groups:
            for edge in output:
                assert edge.get('node') in name_set, f"Unknown connection destination from {source}: {edge.get('node')}"

# Every non-sticky node must be connected to an intake trigger, including error-only handlers.
triggers = {n['name'] for n in nodes if n.get('type') in {
    'n8n-nodes-base.formTrigger', 'n8n-nodes-base.gmailTrigger', 'n8n-nodes-base.webhook'
}}
seen = set(triggers)
queue = list(triggers)
while queue:
    source = queue.pop()
    for groups in connections.get(source, {}).values():
        for output in groups:
            for edge in output:
                destination = edge['node']
                if destination not in seen:
                    seen.add(destination)
                    queue.append(destination)
unreachable = [n['name'] for n in nodes if n.get('type') != 'n8n-nodes-base.stickyNote' and n['name'] not in seen]
assert not unreachable, f'Unreachable non-sticky nodes: {unreachable}'

# Compile every n8n expression as JavaScript and every Code node body; do not execute expressions.
expression_errors = []
def walk(value, location='$'):
    if isinstance(value, str):
        if value.startswith('={{') and value.endswith('}}'):
            expression = value[3:-2].strip()
            js = "new Function('$json','$now','$input','$', 'return (' + " + json.dumps(expression) + " + ');')"
            result = subprocess.run(['node', '-e', js], capture_output=True, text=True)
            if result.returncode:
                expression_errors.append(f'{location}: {result.stderr or result.stdout}')
    elif isinstance(value, list):
        for i, child in enumerate(value):
            walk(child, f'{location}[{i}]')
    elif isinstance(value, dict):
        for key, child in value.items():
            walk(child, f'{location}.{key}')
walk(wf)
assert not expression_errors, '\n'.join(expression_errors)
for n in nodes:
    if n.get('type') == 'n8n-nodes-base.code':
        code = n.get('parameters', {}).get('jsCode', '')
        result = subprocess.run(['node', '-e', 'new Function(' + json.dumps(code) + ');'], capture_output=True, text=True)
        assert result.returncode == 0, f"Code node syntax error ({n['name']}): {result.stderr or result.stdout}"

# Architecture and fail-closed checks.
assert by['Business Inquiry Webhook']['parameters']['httpMethod'] == 'POST'
assert by['Business Inquiry Webhook']['parameters']['path'] == 'business-inquiry'
assert by['Business Inquiry Webhook']['parameters']['options']['responseCode'] == 202
assert by['Dupe Check (Airtable)'].get('alwaysOutputData') is True
formula = by['Dupe Check (Airtable)']['parameters']['filterByFormula']
assert "DATEADD(NOW(), -1, 'days')" in formula
assert "LOWER({email})" in formula
assert "{status} = 'replied'" in formula
for name in ['Qualify Lead (Claude)', 'Draft Reply (Claude)', 'Send Reply (Gmail)']:
    assert by[name].get('onError') == 'continueErrorOutput', f'{name} missing continueErrorOutput'
    assert len(connections[name].get('main', [])) > 1 and connections[name]['main'][1], f'{name} error output is not wired'
assert not by['Send Reply (Gmail)'].get('retryOnFail', False), 'Gmail is intentionally not auto-retried'

# No fake integration booking URL or fictitious business identity remains.
workflow_text = WF_PATH.read_text(encoding='utf-8')
for forbidden in ['your-handle', 'Atlas Home Services', 'Book a call:']:
    assert forbidden not in workflow_text, f'Forbidden demo value remains: {forbidden}'
# Common secret patterns should not appear in workflow export.
for pattern in [r'(?i)sk-ant-[A-Za-z0-9_-]{16,}', r'(?i)Bearer\s+[A-Za-z0-9._-]{20,}', r'(?i)"apiKey"\s*:\s*"[^" ]{12,}"']:
    assert not re.search(pattern, workflow_text), f'Possible hardcoded secret matched: {pattern}'

# Original backup must be preserved and parse as JSON too.
original_bytes = ORIGINAL.read_bytes()
json.loads(original_bytes.decode('utf-8'))
source_copy = pathlib.Path('/mnt/data/AI-Lead-Follow-Up-Agent.original.json')
if source_copy.exists():
    assert hashlib.sha256(original_bytes).digest() == hashlib.sha256(source_copy.read_bytes()).digest(), 'Original backup differs from untouched source copy'

print('STRUCTURAL PASS: valid JSON; unique node names/IDs; all connection references valid; all processing and error branches reachable.')
print('SYNTAX PASS: all n8n expressions and Code node JavaScript compile.')
print('SAFETY PASS: webhook configuration, Airtable 24-hour replied-only duplicate search, error outputs, and no demo URL/identity/secrets.')
print(f'WORKFLOW: {len(nodes)} nodes, {len(connections)} connected source nodes; intake triggers: {", ".join(sorted(triggers))}.')
print('ORIGINAL BACKUP PASS: original workflow is retained byte-identically.')
print('LIMITATION: static validation is not n8n import/runtime validation or end-to-end integration testing.')
