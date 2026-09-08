#!/usr/bin/env python3
"""Rewrite a world's terrain.levels to match the PNGs that actually exist.

The pipeline decides how many levels to emit; the browser decides which one
to download. Having the workflow write the list keeps those two from
disagreeing -- a level named in config.json but missing on disk is a 404 at
startup, and a level on disk but missing from config is dead weight in the
repository nobody notices.

Called by .github/workflows/build-terrain.yml.
"""

import json
import pathlib
import re
import sys

NAME = re.compile(r"_(\d+)x(\d+)\.png$")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: update_levels.py <world-dir>")
        return 2
    world_dir = pathlib.Path(sys.argv[1])
    config_path = world_dir / "config.json"
    config = json.loads(config_path.read_text())

    levels = []
    for png in sorted((world_dir / "terrain").glob("*.png")):
        match = NAME.search(png.name)
        if not match:
            print(f"ERROR: {png.name} is not named <prefix>_<width>x<height>.png")
            return 1
        levels.append({
            "url": f"./{world_dir.as_posix()}/terrain/{png.name}",
            "width": int(match.group(1)),
            "height": int(match.group(2)),
        })
    if not levels:
        print(f"ERROR: no terrain rasters under {world_dir}/terrain")
        return 1

    levels.sort(key=lambda level: level["width"])
    config["terrain"]["levels"] = levels
    config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")

    for level in levels:
        print(f"  {level['width']}x{level['height']}  {level['url']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
