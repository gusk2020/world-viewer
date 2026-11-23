"""Bundles index.html + src/* into one self-contained page for claude.ai Artifact publishing.
Usage: python3 tools/make_artifact.py <out.html>   (three.js stays on the pinned CDN URLs)"""
import re, sys
s = open('index.html').read().replace('<!doctype html>\n', '')
s = re.sub(r'</?(html|head|body)[^>]*>\n?', '', s)
s = s.replace('<meta charset="utf-8">\n', '').replace('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n', '')
s = s.replace('<title>過速世界 船体設計台帳</title>', '<title>過速世界 船体設計台帳</title>\n<style>:root{color-scheme:dark;background:#0a1622}</style>', 1)
s = s.replace('<link rel="stylesheet" href="src/style.css">', '<style>\n' + open('src/style.css').read() + '</style>')
s = s.replace(' defer></script>', '></script>')
s = re.sub(r'<script src="(src/[^"]+)"></script>', lambda m: '<script>' + open(m.group(1)).read().replace('</script', '<\\/script') + '</script>', s)
open(sys.argv[1], 'w').write(s)
