// Node-environment setup: seeds the in-memory test DB so lib/api tests
// can hit it without booting a server. No DOM globals here.
import { initTestDb } from "./fixtures/init-db";
initTestDb();
