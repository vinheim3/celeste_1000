# celeste-goaling

Route finder for the 1000-player Celeste Archipelago async.

## Setup

### 1. Generate static data files

Run these once from your Python project (whenever slot data or the datapackage changes):

```bash
# Generates data/slot_data.json, data/datapackage.json
python archi_api.py --room "1000 celeste" --slot-data-only

# Then export to JSON manually or add a helper:
python - <<'EOF'
from archi_api import hint_init, get_game_datapackage, set_room, _read_json, ROOM_DIR
import json, os

set_room("1000 celeste")
room_status, tracker, static_tracker = hint_init(fetch_slot_data=True, fetch_current=False)

# slot_data.json
slot_data = _read_json(f"{ROOM_DIR}/slot_data_tracker.json")
os.makedirs("celeste-goaling/data", exist_ok=True)
with open("celeste-goaling/data/slot_data.json", "w") as f:
    json.dump(slot_data, f)

# datapackage.json
checksum = static_tracker["datapackage"]["Celeste (Open World)"]["checksum"]
dp = _read_json(f"datapackages/Celeste (Open World)/{checksum}.json")
with open("celeste-goaling/data/datapackage.json", "w") as f:
    json.dump(dp, f)

print("Done")
EOF

# goal_checkpointsanity.json — convert your txt file
python - <<'EOF'
import json
with open("celeste_1000_goal_checkpointsanity.txt") as f:
    data = [line.strip().upper() == "TRUE" for line in f]
with open("celeste-goaling/data/goal_checkpointsanity.json", "w") as f:
    json.dump(data, f)
EOF
```

### 2. Set environment variable

Create `.env.local`:

```
ARCHIPELAGO_TRACKER_ID=<tracker_id_from_room_status_json>
```

The tracker ID is the `tracker` field in `rooms/1000 celeste/room_status.json`.

### 3. Install and run

```bash
npm install
npm run dev
```

### 4. Deploy to Vercel

```bash
npx vercel
```

Set `ARCHIPELAGO_TRACKER_ID` as an environment variable in the Vercel dashboard.
Commit `data/` to the repo — Vercel reads it from the filesystem at runtime.
