# Navigation and Workflow Audit

## Changes in This Review

| Problem | Change | Safety boundary |
| --- | --- | --- |
| Sheet column views hidden in a dropdown | Full Template, Bookings, Assignments and Payments are visible one-click choices | Changing a view does not discard drafts or save data |
| Spreadsheet/List controls duplicated a second navigation row | Spreadsheet, List, Boats & Vans and Accounts share one navigation row | Dedicated planning and accounting views remain available |
| Sidebar unavailable below 1280px | Visible by default from 1024px; explicitly pinnable from 768px; hide/show choice remembered on this device | Phones use an overlay menu; a phone visit does not erase the tablet/desktop preference |
| Mobile section switch required opening a dropdown | Direct contextual links for guest operations and on-water work | Permission-filtered; kitchen retains its existing direct workflow links |
| Boarding/activity boat filters required two interactions | Visible All Boats and individual boat buttons | Attendance still saves through the checked, version-aware workflow |
| Maintenance and attendance had different view-control styling | Shared view-choice component, visible selected state and wrapping labels | No changes to permissions or status meanings |
| Selecting a planned boat/van left its staff blank | Reuse that day's assigned captain, crew and driver; fill directory contact numbers | Exact registered matches only; conflicting choices are not guessed; changing resources clears old resource staff |
| New booking paste could blank shared staff | Blank staff columns on a new pasted row retain existing assigned staff; explicit pasted names still apply | Existing rows can still be deliberately corrected; server conflict checks remain in place |
| Moving between operational sections reset the selected date | Retain service date between sheet, passengers, pickup, boats, boarding, activities and meal needs | Tab-local preference, not a change to records; fresh-day navigation defaults to today |
| Fifty requested items required retyping quantities | Use Requested Quantities fills empty purchase quantities together | Never overwrites edited quantities or fills costs; explicit review and confirmation still required |
| Stock entry overflowed with a tablet sidebar | Compact rows respond to actual content width; removed the fixed 32rem summary width | Unit/carton quantities, costs and confirmation logic unchanged |
| Damage form silently selected the first boat | New damage reports require an explicit boat choice | No guessed damage attribution |

## Connections Checked

The system already reuses saved bookings and assignments in pickup, boat planning and manifests. Meal needs feed the kitchen view. Assigned boats create scheduled-trip records; departure/return confirmation records actual movement. Purchase requests feed purchasing, confirmed purchases feed receiving, and confirmed receiving changes inventory. POS recipe consumption and stock deductions remain server-controlled. Booking receipts and commission terms remain accounting records rather than inferred from attendance.

This review improves those handoffs without automatically declaring that a person arrived, goods were received, money was collected or a boat departed. Those are new facts that staff must confirm, not values that can safely be copied from a plan.

## Checks

- Automated page-containment checks on 28 main routes at 390px, 768px and 1440px, with 320px/1024px/1200px checks for the changed workspaces.
- 100 unlocked screenshots in the direct-workflows gallery, including a pinned tablet sidebar, single-click sheet views, boarding filters and 50-item purchase entry.
- Sheet defaults, draft retention across view changes, sidebar preferences across navigation/reload, existing-resource autofill, ambiguous-name protection, blank-paste protection and cross-section date retention.
- Existing weekly transaction/retry, booking/accounting/planner-access, spreadsheet/group-attendance/POS and local database integration suites.
- Browser tests use isolated sample records and reject cloud-mode execution. They do not verify the live Supabase deployment or physical iPhone Safari.

## Remaining Boundaries

This is not a claim that every combination of data and device is bug-free. Large historic tables still need their own horizontal scrolling. Selecting a directory employee, an inventory item or one of many locations can legitimately use a searchable choice control instead of filling the screen with hundreds of buttons.

Hotel/street matching must not silently guess a location from similar names. The booking sheet currently accepts free-text pickup names; automatically linking them to map coordinates needs a separate, permission-aware location-directory handoff and a visible way to resolve ambiguous matches. Likewise, booked pax must not be silently treated as actual arrivals, and blank receipts must not be treated as paid.

The existing production bundle-size warning remains a performance follow-up. This update does not migrate or modify the live POS/Supabase database. The shared review continues to use sample data.

## Research Used

- [W3C: Redundant Entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html): reuse information already provided in the same process instead of requiring it again.
- [W3C Technique G221](https://www.w3.org/WAI/WCAG22/Techniques/general/G221): make previous entries available when subsequent steps need them.
- [Nielsen Norman Group: Does Your Form Really Need a Dropdown?](https://www.nngroup.com/articles/dropdown-list/): prefer visible choices when users need to discover or frequently switch between a small set of options.
- [Nielsen Norman Group: Hidden Navigation](https://www.nngroup.com/articles/hamburger-menus/): hiding navigation reduces discoverability and increases interaction cost, particularly when desktop space is available.
