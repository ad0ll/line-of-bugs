// vitest.config.ts sets DATABASE_URL=":memory:" via `test.env`, which
// vitest applies before any module evaluates — ES-module import
// hoisting would otherwise pull these imports above an assignment
// and the db singleton would bind to the real production file.

import "@testing-library/jest-dom/vitest";
import { initTestDb } from "./fixtures/init-db";

initTestDb();
