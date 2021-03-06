#!/usr/bin/env python3

import glob
import http.server
import os
import shutil
import socketserver
import sys

from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from watchdog.events import LoggingEventHandler

SCRIPT_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = Path(os.path.realpath(SCRIPT_DIR / "../../../"))
BUILD_DIR = ROOT_DIR / "out/cmake-webgl-release"
TOOLS_DIR = ROOT_DIR / "out/cmake-release/tools"
SERVE_DIR = BUILD_DIR / "libs/filamentjs"
GLMATRIX_DIR = ROOT_DIR / "third_party/gl-matrix"
CURR_DIR = Path(os.path.realpath('.'))
PORT = 8000

global server

# Restart the script if the JavaScript or HTML change.

class OnDirectoryChanged(FileSystemEventHandler):
    def on_modified(self, event):
        global server
        if event.event_type != 'modified':
            return
        server.shutdown()
        print(f'{event.src_path} was modified\nRestarting...')
        os.chdir(CURR_DIR)
        os.execl(sys.executable, *([sys.executable]+sys.argv))

print("Starting observer...")
handler = OnDirectoryChanged()
observer = Observer()
observer.schedule(handler, path=str(CURR_DIR), recursive=True)
observer.start()

# Copy test assets into the server folder.

print("Copying assets...")
def do_glob(path):
    return glob.glob(str(path))
src_assets = (
  do_glob(BUILD_DIR / "samples/web/public/material/*") +
  do_glob(BUILD_DIR / "samples/web/public/monkey/*") +
  do_glob(BUILD_DIR / "samples/web/public/pillars_2k/*") +
  do_glob(GLMATRIX_DIR / "*.js") +
  do_glob(SCRIPT_DIR / "test_*.*"))
for src in src_assets:
    shutil.copy(src, SERVE_DIR)

# Snarf various test assets from an existing Android sample.

def build_filamat(matsrc, matdst):
    flags = '-O -a opengl -p mobile'
    matc_exec = os.path.join(TOOLS_DIR, 'matc/matc')
    cmd = f"{matc_exec} {flags} -o {matdst} {matsrc}"
    print("Invoking matc...")
    retval = os.system(cmd)
    if retval != 0:
        exit(retval)

def build_cubemaps(hdrfile, dstfolder):
    iblfile = hdrfile.stem + "_ibl.ktx"
    skyfile = hdrfile.stem + "_skybox.ktx"
    flags = '--format=ktx --size=256 --extract-blur=0.1'
    cmgen_exec = os.path.join(TOOLS_DIR, 'cmgen/cmgen')
    cmd = f"{cmgen_exec} {flags} -x {dstfolder} {hdrfile}"
    if (dstfolder / iblfile).exists():
        print("Skipping cmgen...")
        return
    print("Invoking cmgen...")
    retval = os.system(cmd)
    if retval != 0:
        exit(retval)
    (dstfolder / hdrfile.stem / iblfile).rename(dstfolder / iblfile)
    (dstfolder / hdrfile.stem / skyfile).rename(dstfolder / skyfile)

parquet_srcdir = ROOT_DIR / 'android/samples/textured-object/app/src/main/'
parquet_iblsrc = ROOT_DIR / 'third_party/environments/venetian_crossroads_2k.hdr'
parquet_matsrc = parquet_srcdir / 'materials/textured_pbr.mat'
parquet_filamesh = parquet_srcdir / 'assets/models/shader_ball.filamesh' # based on third_party/shader_ball
parquet_texturedir = parquet_srcdir / 'res/drawable-v24'
parquet_textures = [
    parquet_texturedir / 'floor_ao_roughness_metallic.png',
    parquet_texturedir / 'floor_basecolor.png',
    parquet_texturedir / 'floor_normal.png']

build_filamat(parquet_matsrc, SERVE_DIR / "parquet.filamat")
build_cubemaps(parquet_iblsrc, SERVE_DIR)
shutil.copy(parquet_filamesh, SERVE_DIR)
for tex in parquet_textures:
    shutil.copy(tex, SERVE_DIR)

# Associate wasm files with the correct MIME type.

Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({
    '.wasm': 'application/wasm',
})

# Serve all files in the server folder.

print(f"Serving {SERVE_DIR}...")
print(f"    http://localhost:{PORT}/test_redball.html")
print(f"    http://localhost:{PORT}/test_parquet.html")
Handler.directory = SERVE_DIR
os.chdir(SERVE_DIR)
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    global server
    server = httpd
    httpd.allow_reuse_address = True
    httpd.serve_forever()

observer.stop()
observer.join()
