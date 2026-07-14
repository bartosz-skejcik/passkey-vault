-- AUTH-07 potrzebuje user_agent (do wyświetlenia listy urządzeń) i
-- last_used_at (do "ostatnio aktywna"). Addytywna migracja — SQLite wspiera
-- `ALTER TABLE ... ADD COLUMN` bez ograniczeń, które wymusiły DROP+CREATE w
-- 0003 (tam kolumna brała udział w CHECK-u/FK; tu nie).

ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN last_used_at TEXT;
