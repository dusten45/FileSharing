import os
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog

from tkinterdnd2 import TkinterDnD, DND_FILES

from config import SIZE_LIMIT_MB
from processor import process_file, process_folder


class App(TkinterDnD.Tk):
    def __init__(self):
        super().__init__()
        self.title("Discord File Uploader")
        self.geometry("520x440")
        self.resizable(False, False)
        self.configure(bg="#1e1f22")
        self._build_ui()

    def _build_ui(self):
        DARK   = "#1e1f22"
        PANEL  = "#2b2d31"
        ACCENT = "#5865f2"   # Discord Blurple
        TEXT   = "#dbdee1"
        MUTED  = "#949ba4"

        self.configure(bg=DARK)

        # ── Header ──
        header = tk.Frame(self, bg=DARK)
        header.pack(fill="x", padx=24, pady=(20, 0))

        tk.Label(
            header,
            text="Discord File Uploader",
            font=("Segoe UI", 16, "bold"),
            fg=TEXT, bg=DARK,
        ).pack(side="left")

        # ── Info label ──
        info_text = (
            f"≤ {SIZE_LIMIT_MB:.0f} MB  →  Discord 직접 업로드\n"
            f"> {SIZE_LIMIT_MB:.0f} MB  →  Google Drive + 링크 전송\n"
            f"폴더: 크기에 따라 zip 후 Discord 또는 Drive 폴더 업로드"
        )
        info = tk.Label(
            self,
            text=info_text,
            font=("Segoe UI", 10),
            fg=MUTED, bg=DARK,
            justify="left",
        )
        info.pack(anchor="w", padx=26, pady=(6, 12))

        # ── Buttons ──
        btn_frame = tk.Frame(self, bg=PANEL, relief="flat", bd=0)
        btn_frame.pack(fill="x", padx=24)

        self._file_btn = tk.Button(
            btn_frame,
            text="📂  파일 선택",
            font=("Segoe UI", 11, "bold"),
            fg="white",
            bg=ACCENT,
            activebackground="#4752c4",
            activeforeground="white",
            relief="flat",
            bd=0,
            padx=20,
            pady=10,
            cursor="hand2",
            command=self._pick_file,
        )
        self._file_btn.pack(side="left", pady=14, padx=(14, 6))

        self._folder_btn = tk.Button(
            btn_frame,
            text="📁  폴더 선택",
            font=("Segoe UI", 11, "bold"),
            fg="white",
            bg="#3ba55c",   # 초록색으로 구분
            activebackground="#2d8049",
            activeforeground="white",
            relief="flat",
            bd=0,
            padx=20,
            pady=10,
            cursor="hand2",
            command=self._pick_folder,
        )
        self._folder_btn.pack(side="left", pady=14, padx=(0, 14))

        # ── Drop zone ──
        self._drop_zone = tk.Frame(self, bg=PANEL, highlightthickness=2,
                                   highlightbackground=MUTED, highlightcolor=ACCENT)
        self._drop_zone.pack(fill="x", padx=24, pady=(8, 0))

        self._drop_label = tk.Label(
            self._drop_zone,
            text="여기에 파일 또는 폴더를 드래그 & 드롭",
            font=("Segoe UI", 10),
            fg=MUTED, bg=PANEL,
            pady=10,
        )
        self._drop_label.pack()

        for widget in (self._drop_zone, self._drop_label):
            widget.drop_target_register(DND_FILES)
            widget.dnd_bind("<<DragEnter>>", self._on_drag_enter)
            widget.dnd_bind("<<DragLeave>>", self._on_drag_leave)
            widget.dnd_bind("<<Drop>>",      self._on_drop)

        self._drop_zone_colors = (PANEL, MUTED, ACCENT)  # bg, border_normal, border_hover

        # ── Log area ──
        log_frame = tk.Frame(self, bg=PANEL)
        log_frame.pack(fill="both", expand=True, padx=24, pady=(8, 24))

        scrollbar = tk.Scrollbar(log_frame)
        scrollbar.pack(side="right", fill="y")

        self._log_box = tk.Text(
            log_frame,
            font=("Consolas", 10),
            fg=TEXT,
            bg="#1a1b1e",
            insertbackground=TEXT,
            relief="flat",
            bd=0,
            padx=10,
            pady=8,
            state="disabled",
            wrap="word",
            yscrollcommand=scrollbar.set,
        )
        self._log_box.pack(fill="both", expand=True)
        scrollbar.config(command=self._log_box.yview)

        self._log("준비됨. 파일 또는 폴더를 선택하거나 드래그 & 드롭하세요.")

    def _log(self, msg: str):
        self._log_box.config(state="normal")
        self._log_box.insert("end", msg + "\n")
        self._log_box.see("end")
        self._log_box.config(state="disabled")

    def _set_buttons(self, enabled: bool):
        state = "normal" if enabled else "disabled"
        self._file_btn.config(state=state)
        self._folder_btn.config(state=state)
        if not enabled:
            self._file_btn.config(text="처리 중...")
            self._folder_btn.config(text="처리 중...")
        else:
            self._file_btn.config(text="📂  파일 선택")
            self._folder_btn.config(text="📁  폴더 선택")

    def _pick_file(self):
        filepath = filedialog.askopenfilename(title="업로드할 파일 선택")
        if not filepath:
            return
        self._log("\n" + "─" * 48)
        self._set_buttons(False)
        threading.Thread(
            target=self._run_file,
            args=(filepath,),
            daemon=True,
        ).start()

    def _run_file(self, filepath):
        try:
            process_file(filepath, lambda msg: self.after(0, self._log, msg))
        finally:
            self.after(0, self._set_buttons, True)

    def _pick_folder(self):
        folder_path = filedialog.askdirectory(title="업로드할 폴더 선택")
        if not folder_path:
            return
        self._log("\n" + "─" * 48)
        self._set_buttons(False)
        threading.Thread(
            target=self._run_folder,
            args=(folder_path,),
            daemon=True,
        ).start()

    def _run_folder(self, folder_path):
        try:
            process_folder(folder_path, lambda msg: self.after(0, self._log, msg))
        finally:
            self.after(0, self._set_buttons, True)

    def _on_drag_enter(self, event):
        bg, _, accent = self._drop_zone_colors
        self._drop_zone.config(bg=accent, highlightbackground=accent)
        self._drop_label.config(bg=accent, fg="white")

    def _on_drag_leave(self, event):
        bg, muted, _ = self._drop_zone_colors
        self._drop_zone.config(bg=bg, highlightbackground=muted)
        self._drop_label.config(bg=bg, fg=muted)

    def _on_drop(self, event):
        if self._file_btn["state"] == "disabled":
            return
        paths = self.tk.splitlist(event.data)
        if not paths:
            return
        self._on_drag_leave(None)
        self._set_buttons(False)
        threading.Thread(target=self._run_multiple, args=(paths,), daemon=True).start()

    def _run_multiple(self, paths):
        total = len(paths)
        try:
            for i, path in enumerate(paths, 1):
                label = Path(path).name + ("/" if os.path.isdir(path) else "")
                self.after(0, self._log, f"\n{'─' * 48}")
                if total > 1:
                    self.after(0, self._log, f"[{i}/{total}] {label}")
                log = lambda msg: self.after(0, self._log, msg)
                if os.path.isdir(path):
                    process_folder(path, log)
                else:
                    process_file(path, log)
        finally:
            self.after(0, self._set_buttons, True)
