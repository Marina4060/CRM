# CRM

A monday.com-style CRM board app for a real estate team. It's plain HTML, CSS and JavaScript: no build step, no server, no dependencies.

## Run it

Open `index.html` in a browser. To serve it locally instead:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

Data is saved in the browser (localStorage). Use **Back up data (JSON)** in the sidebar to keep a copy or move it to another computer, and **Restore backup** to load it back.

## Features

- **Boards** – sample *Buyer Leads*, *Listings* and *Team Tasks* boards. Add, rename (click the title) or delete boards.
- **Groups** – collapsible, colour-coded groups (e.g. Hot leads / Nurture / Closed). Rename inline, change colour, add or delete.
- **Columns** – Text, Status (coloured labels), Person, Date, Number (optionally $), Phone (click to call), Email (click to email). Add, rename, reorder, edit status labels, delete.
- **Inline editing** – click any cell to edit; status and person pickers pop up.
- **Drag and drop** – drag rows (⠿ handle) to reorder or move between groups; drag Kanban cards between status lanes.
- **Kanban view** – cards grouped by any status column.
- **Item panel** – open an item (⤢) to edit all fields and post updates (call notes, next steps).
- **Summaries** – per-group status distribution bars and number totals.
- **Overdue highlighting** – past follow-up/deadline dates show in red unless the item is done, sold, purchased, lost or withdrawn.
- **Search, person filter, CSV export** of the current board.
