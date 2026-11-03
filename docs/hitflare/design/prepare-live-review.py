"""Prepare offline design snapshots from the inspected production DOM.

Retains production classes, icons, fields and layout. Removes scripts/network
actions; uses existing public sample images for media. Does not build the app.
"""
from pathlib import Path
from html import escape
from html.parser import HTMLParser
import hashlib
import json
import re
import shutil

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RAW = HERE / 'live-audit'
OUT = RAW / 'snapshots'
OUT.mkdir(exist_ok=True)
SAMPLES = [
    'home/creative-workspace.png',
    'brand/hitflare-login-background-clean.png',
    'home/inspirations/photo-solver-v1.png',
    'templates/tpl_bg-v1.svg',
    'templates/tpl_model-v1.svg',
    'templates/tpl_poster-v1.svg',
]


def asset(value):
    if value.startswith('/api/') or value.startswith('blob:'):
        key = value.split('?')[0]
        index = int(hashlib.sha256(key.encode()).hexdigest()[:8], 16) % len(SAMPLES)
        return '../../../web/public/' + SAMPLES[index]
    if value.startswith(('/brand/', '/icons/', '/home/', '/templates/')):
        return '../../../web/public' + value
    return value


class SnapshotParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'iframe'):
            self.skip += 1
            return
        if self.skip:
            return
        converted = []
        for name, value in attrs:
            if name.startswith('on') or name in ('srcset', 'action', 'formaction'):
                continue
            if name == 'href' and tag == 'a':
                converted.append(('data-original-href', value))
                value = '#'
            if name == 'src' and value:
                value = asset(value)
            if name == 'style' and value:
                value = re.sub(r'(/api/[^\s)"\']+)', lambda m: asset(m[1]), value)
            converted.append((name, value))
        attributes = ''.join(' ' + name + ('' if value is None else '="' + escape(value, quote=True) + '"') for name, value in converted)
        self.parts.append('<' + tag + attributes + '>')

    def handle_endtag(self, tag):
        if tag in ('script', 'iframe') and self.skip:
            self.skip -= 1
        elif not self.skip:
            self.parts.append('</' + tag + '>')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

    def handle_entityref(self, name):
        if not self.skip:
            self.parts.append('&' + name + ';')

    def handle_charref(self, name):
        if not self.skip:
            self.parts.append('&#' + name + ';')


manifest = []
for path in sorted(RAW.glob('*.json')):
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or 'html' not in data:
        continue
    parser = SnapshotParser()
    parser.feed(data['html'])
    data['html'] = ''.join(parser.parts)
    data['stylesheets'] = ['live-audit/source-ui.css']
    data['provenance'] = 'Production DOM from index-Ekhs99d-.js; images substituted locally; no production scripts.'
    (OUT / path.name).write_text(json.dumps(data, ensure_ascii=False))
    manifest.append({'scene': path.stem, 'viewport': data['viewport']})

shutil.copyfile(ROOT / 'outputs/release/hitflare-release-v0.18.9/web/dist/assets/index-Do32o6QI.css', RAW / 'source-ui.css')
(RAW / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(f'Prepared {len(manifest)} production-layout snapshots.')
