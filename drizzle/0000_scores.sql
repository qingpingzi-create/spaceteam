CREATE TABLE scores (
 id TEXT PRIMARY KEY NOT NULL,
 player_key TEXT NOT NULL,
 nickname TEXT NOT NULL,
 mode TEXT NOT NULL CHECK (mode IN ('keyboard', 'mouse', 'touch')),
 score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
 accuracy INTEGER NOT NULL CHECK (accuracy BETWEEN 0 AND 100),
 median_ms INTEGER,
 deviation_ms INTEGER,
 valid_hits INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 records_json TEXT NOT NULL,
 payload_hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX scores_mode_ranking ON scores (mode, score DESC, accuracy DESC, median_ms, created_at);
--> statement-breakpoint
CREATE INDEX scores_player_history ON scores (player_key, mode, created_at DESC);
