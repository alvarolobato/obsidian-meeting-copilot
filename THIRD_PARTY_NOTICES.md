# Third-party notices

Meeting Copilot incorporates and adapts code from the following projects. We are
grateful to their authors. All are permissively licensed; attribution is provided
here as a courtesy (0BSD does not legally require it).

## System Recording (base project)

- Author: Yuto Takagi
- Source: https://github.com/yut0takagi/obsidian-system-recording
- License: 0BSD

Meeting Copilot is a fork of System Recording. The dual-channel ScreenCaptureKit
recorder (`swift-helper/`, `src/binary*.ts`, `src/recorder*`), the Google Calendar
integration (`src/calendar/`), and the core plugin scaffolding originate from this
project.

```
Copyright (C) 2020-2025 by Dynalist Inc.

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT,
OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA
OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Planned adaptations (not yet incorporated)

The meeting agenda sidebar view will adapt UI code from:

- **Meetings Plus** — Jacob Holm — https://github.com/jabaho9523/obsidian-meetings-plus — 0BSD
- **Day Planner** (view registration/activation patterns) — Ivan Lednev — https://github.com/ivan-lednev/obsidian-day-planner — MIT

Per-file attribution headers will be added to any adapted files when that code lands.
