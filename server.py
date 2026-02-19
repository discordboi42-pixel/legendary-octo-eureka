#!/usr/bin/env python3
import cgi
import json
import mimetypes
import os
import posixpath
import re
import shutil
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
METADATA_FILE = DATA_DIR / "recordings.json"
UPLOAD_KEY = os.environ.get("SPHOORTHI_UPLOAD_KEY", "sphoorthi-owner-key")

DATA_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)
if not METADATA_FILE.exists():
    METADATA_FILE.write_text("[]", encoding="utf-8")


class SphoorthiHandler(BaseHTTPRequestHandler):
    server_version = "SphoorthiHTTP/1.0"

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/recordings":
            return self.send_recordings()
        if path.startswith("/audio/"):
            rec_id = path.rsplit("/", 1)[-1]
            return self.send_audio(rec_id)
        return self.serve_static(path)

    def do_POST(self):
        if self.path != "/api/recordings":
            return self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
        if not self.is_owner():
            return self.send_error(HTTPStatus.UNAUTHORIZED, "Owner key required")

        ctype, pdict = cgi.parse_header(self.headers.get("content-type", ""))
        if ctype != "multipart/form-data":
            return self.send_error(HTTPStatus.BAD_REQUEST, "Use multipart/form-data")

        pdict["boundary"] = bytes(pdict["boundary"], "utf-8")
        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST"}, keep_blank_values=False)

        audio = form["audioFile"] if "audioFile" in form else None
        title = form.getfirst("title", "").strip()
        selected_date = form.getfirst("selectedDate", "").strip()
        selected_day = form.getfirst("selectedDay", "").strip()

        if audio is None or not getattr(audio, "filename", None) or not title or not selected_date or not selected_day:
            return self.send_error(HTTPStatus.BAD_REQUEST, "Missing required fields")

        rec_id = str(uuid.uuid4())
        ext = Path(audio.filename).suffix.lower()
        if not re.match(r"^\.[a-z0-9]{1,8}$", ext):
            ext = ".bin"

        storage_name = f"{rec_id}{ext}"
        file_path = UPLOADS_DIR / storage_name

        with file_path.open("wb") as out:
            shutil.copyfileobj(audio.file, out)

        mime_type = audio.type or mimetypes.guess_type(storage_name)[0] or "application/octet-stream"

        record = {
            "id": rec_id,
            "title": title,
            "selectedDate": selected_date,
            "selectedDay": selected_day,
            "uploadedAt": datetime.now(timezone.utc).isoformat(),
            "fileName": Path(audio.filename).name,
            "storageName": storage_name,
            "mimeType": mime_type,
            "audioUrl": f"/audio/{rec_id}",
        }

        items = self.load_metadata()
        items.append(record)
        self.save_metadata(items)

        self.send_json({"ok": True, "record": record}, status=HTTPStatus.CREATED)

    def do_DELETE(self):
        if not self.path.startswith("/api/recordings/"):
            return self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
        if not self.is_owner():
            return self.send_error(HTTPStatus.UNAUTHORIZED, "Owner key required")

        rec_id = self.path.rsplit("/", 1)[-1]
        items = self.load_metadata()
        target = next((x for x in items if x["id"] == rec_id), None)
        if not target:
            return self.send_error(HTTPStatus.NOT_FOUND, "Recording not found")

        file_path = UPLOADS_DIR / target["storageName"]
        if file_path.exists():
            file_path.unlink()

        items = [x for x in items if x["id"] != rec_id]
        self.save_metadata(items)
        self.send_json({"ok": True})

    def send_recordings(self):
        items = sorted(self.load_metadata(), key=lambda x: x.get("uploadedAt", ""), reverse=True)
        self.send_json(items)

    def send_audio(self, rec_id: str):
        items = self.load_metadata()
        target = next((x for x in items if x["id"] == rec_id), None)
        if not target:
            return self.send_error(HTTPStatus.NOT_FOUND, "Audio not found")

        file_path = UPLOADS_DIR / target["storageName"]
        if not file_path.exists():
            return self.send_error(HTTPStatus.NOT_FOUND, "Audio file missing")

        file_size = file_path.stat().st_size
        mime_type = target.get("mimeType", "application/octet-stream")
        range_header = self.headers.get("Range")

        if range_header:
            match = re.match(r"bytes=(\d*)-(\d*)", range_header)
            if not match:
                return self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            start = int(match.group(1)) if match.group(1) else 0
            end = int(match.group(2)) if match.group(2) else file_size - 1
            end = min(end, file_size - 1)
            if start > end:
                return self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)

            length = end - start + 1
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Type", mime_type)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()
            with file_path.open("rb") as f:
                f.seek(start)
                self.wfile.write(f.read(length))
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        with file_path.open("rb") as f:
            shutil.copyfileobj(f, self.wfile)

    def serve_static(self, path: str):
        if path in ("", "/"):
            rel = "index.html"
        else:
            rel = posixpath.normpath(unquote(path)).lstrip("/")

        allowed = {"index.html", "styles.css", "script.js"}
        if rel not in allowed:
            return self.send_error(HTTPStatus.NOT_FOUND, "Not found")

        file_path = ROOT / rel
        if not file_path.exists():
            return self.send_error(HTTPStatus.NOT_FOUND, "Not found")

        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        content = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def is_owner(self):
        return self.headers.get("X-Upload-Key", "") == UPLOAD_KEY

    def load_metadata(self):
        try:
            return json.loads(METADATA_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []

    def save_metadata(self, items):
        METADATA_FILE.write_text(json.dumps(items, indent=2), encoding="utf-8")

    def send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "4173"))
    server = ThreadingHTTPServer(("0.0.0.0", port), SphoorthiHandler)
    print(f"Sphoorthi server running at http://0.0.0.0:{port}")
    print("Set SPHOORTHI_UPLOAD_KEY to your private key before starting in production.")
    server.serve_forever()
