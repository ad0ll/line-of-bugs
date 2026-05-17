// Browser-environment setup: vitest-browser-react's render returns its
// own `screen` object and `expect.element()` provides retry-based DOM
// assertions, so we don't import @testing-library/jest-dom.
//
// Load globals.css so component tests that assert computed styles
// (e.g., SessionActionBar's equal-width slot, no-underline source link)
// see the same cascade the production app uses.
import "@/app/globals.css";
