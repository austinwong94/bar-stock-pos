# Kitchen amount visibility on small screens

The retained keyboard-height regression reproduced an obscured quantity: at 320 x 380 the active 44px field was at 167.89-211.89 while the pinned labels ended at 193px. The earlier 390 x 460 check was intermittent. The strengthened test checks both languages and 320/390/768px widths at 380px height as well as the existing phone/tablet/desktop screens.

Daily kitchen usage now measures the pinned labels, footer and visual viewport after focus, layout and viewport changes. It moves only an obscured, enabled quantity input belonging to that visible form. It neither moves focus to another field nor changes input values, storage, stock or submission state. Scroll margins make late browser centering respect the same safe area. Optional clearance shrinks when the full 44px field fits but a fixed 8px gap on each side would not. Observers, viewport listeners and scheduled frames are cleaned up when the form becomes inactive, read-only, loading or under confirmation.

The first correction still failed in Malay because the 57px space could not fit the field plus 16px of fixed clearance. The event-order trace showed the later centre-scroll and updated margins; this evidence was retained rather than rerunning equivalent attempts. Adaptive clearance resolves that measured case. The controlled browser test also simulates a visual viewport that shrinks independently from the layout viewport and has a nonzero top offset. These are browser fixtures, not proof from a physical iPhone or Android keyboard.

Existing tests continue to verify fifty-item lists, active guest/staff labels, quantity-column alignment, sidebar resizing, guest-then-staff Next navigation, no submission from Enter, account-isolated units, blank new-day quantities, retained same-day drafts and one stock deduction after a lost reply. The stock-in bookmark now redirects to the canonical Stock Activity route, preserving the existing permission guard and highlighting Stock rather than Overview. It creates no new entry.

No schema, account, live product, price, stock, usage, receipt or sales records are changed by this work. Hosted verification is read-only. Physical keyboard/device acceptance and actual opening-stock setup remain separate launch requirements.

API references: [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport), [ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver).

Evidence: `.qa/release/kitchen-focus-narrow-before-20261115.log`, `kitchen-focus-narrow-fixed-20261115.log`, `kitchen-focus-scroll-margins-20261115.log`, `kitchen-focus-event-order-diagnostic-20261115.log`, `kitchen-focus-adaptive-clearance-20261115.log`, `kitchen-focus-final-20261115.log`, and `kitchen-focus-stock-navigation-20261115.log`. Screenshots are isolated, labelled sample records in `.qa/screenshots/kitchen-quick-entry/keyboard-entry-{en,ms}-{320,390,768}.png`; no real stock was entered for screenshots.
