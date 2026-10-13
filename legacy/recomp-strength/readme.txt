RECOMP STRENGTH PWA

Files:
- index.html
- manifest.webmanifest
- sw.js
- icon-192.png
- icon-512.png

Deploy the ENTIRE folder to an HTTPS host such as Netlify. A service worker normally does not install from a local file:// URL.

iPhone:
1. Open the deployed site in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Launch from the new home-screen icon.

Preset plans included:
- AB3 Split (existing app plan)
- Original 7-Day Plan (recreated from the reference schedule)
- Mon/Tue/Thu/Fri Split (upper/lower, all exercises repeated across the 3 daily sessions)

Data is stored locally in browser storage and can be exported from Settings.

V4 CHANGES
- Original 7-Day Plan now repeats that day's SAME exercises in all three daily workout sessions.
- Exercise-day placement is unchanged.
- Original set volume is distributed across the three sessions; where an exercise originally had only 2 sets, it becomes 1 set/session (3 total) so it appears in every workout.
- Saturday farmer walks retain 4 total sets as 2 + 1 + 1.
- Tapping Workout 1 / Workout 2 / Workout 3 on the Today schedule opens a table with exercises, sets/reps, recommended load, RIR and real-life carryover.
- The session table can open the workout logger directly.

V5 CHANGES
- Added a Creatine Loading Phase toggle in Nutrition Settings.
- ON: body-weight-based ~0.3 g/kg/day loading target, capped at 20 g/day in the app, split into 4 doses.
- OFF: switches to a single 5 g/day maintenance dose.
- Today's training-day and recovery-day schedules automatically change when the setting is saved.
- The settings screen previews the current creatine schedule before saving.

V6 CHANGES
- Plan view now displays exactly one exercise per row within Morning/Midday/Evening.
- Mobile layout stacks exercise name over prescription for easier scanning.
- No exercise selection, set/rep prescription, load recommendation, nutrition, or preset logic changed.

V7 CHANGES
- Compact Plan view: exercise name and prescription are on the same line.
- Removed divider lines and large vertical padding between exercises.
- Preserved one exercise per row while making each Morning/Midday/Evening block much shorter.
- Very narrow screens keep the row intact instead of deliberately stacking name and prescription.
- No workout programming, weights, presets, nutrition, creatine, or logging logic changed.

V8 CHANGES
- PR page adds a 95% strength goal column.
- Today schedule converts protein/carbohydrate timing recommendations into actual grams from today's entered body weight.
- Schedule values update when today's weight or nutrition g/kg settings change.
- Existing presets, PWA assets, workout logging, creatine toggle, compact Plan layout, and all other v7 behavior are preserved.

V9 SAVE / RESET FIX
- Fixed Reset App Data: it now removes the current storage key AND both legacy keys.
- Previous builds removed only recompStrengthStateV2, while loadState could fall back to recompStrengthState after reset.
- Added a new V3 storage key with automatic migration from v7/v8.
- State structure is normalized after loading so workouts is always an array and PR/settings objects are valid.
- Every save is immediately read back and verified before the UI reports success.
- Workout logger now shows an explicit Saved confirmation with the number of sets.
- Failed workout writes keep the form open instead of silently closing and losing the entry.
- Weight/settings saves are also verified.

V10 CALF-RAISE LOGGING FIX
- Calf Raise is now modeled as a bodyweight exercise that can also accept external load.
- Logger shows an Added lb field for calf raises; use 0 for bodyweight-only sets.
- Added calf weight is preserved in workout logs and now counts toward calf PR progression.
- PR table displays BW × reps or BW + added weight × reps.
- Calf estimated strength uses bodyweight + external load when today's/latest weight is available.
- Pure bodyweight exercises still disable the load field.

V11 DATA MANAGEMENT + EXERCISE CONFIGURATION
- JSON Import added with category selection before import.
- Import supports Merge or Replace for selected categories.
- Selective Delete added for workouts, weights, PRs, settings, exercise configs and active preset.
- Exercise Configurations section added for every exercise.
- Tracking type can be changed among Weighted load, Bodyweight only, BW + Added, and Timed / carry.
- Per-exercise Reset removes only that exercise from workout logs, restores its seeded PR if present, and restores its default tracking type.
- Exercise configuration overrides are exported/imported in JSON.
- Existing v10 calf BW + Added behavior is preserved as its default.

V12 CONFIGURABLE MEAL COUNT
- Nutrition Settings now includes 2–6 meals per training day.
- Daily protein target for meal allocation = midpoint between configured protein min/max.
- Daily carb target for meal allocation = midpoint between configured carb min/max.
- Those midpoint daily totals are divided evenly by the selected number of meals.
- Training-day meal slots:
  6: Pre 1, Post 1, Pre 2, Post 2, Pre 3, Post 3
  5: Post 1, Pre 2, Post 2, Pre 3, Post 3
  4: Post 1, Post 2, Pre 3, Post 3
  3: Post 1, Post 2, Post 3
  2: Post 1, Post 2
- Skipping meals does not remove workouts.
- Creatine loading remains four doses even when a nutrition slot is skipped; skipped pre-workout meal slots can become creatine-only schedule entries.
- Maintenance creatine is attached to the first active meal.
- Recovery days distribute the chosen number of equal meals across the day.
- JSON import/export and settings resets automatically include mealCount.

V13 PR GOAL PROGRESS
- Adds a comparable 95% Goal Value column.
- Adds 0-to-goal percentage progress plus a compact progress bar.
- Weighted rep goals use Epley-equivalent strength; range goals use the range midpoint.
- Pure bodyweight goals use rep progress.
- Carry goals use external-load progress.
- Calf goals use total system load (bodyweight + added load) when weight is available.
- Weighted punches intentionally show N/A progress because their goal is speed/control, not maximum load.
- The Exercise column is sticky and remains visible while horizontally scrolling.

V14 REAL-WORLD STRENGTH ALIGNMENT
- Pre-V14 exercises are preserved and renamed with the visible prefix "Legacy —".
- Fresh replacement versions keep the original exercise names and are used by the current plans.
- Pre-V14 AB3, Original 7-Day and Mon/Tue/Thu/Fri plans are preserved as Legacy presets.
- Replacement presets with the original names now prioritize deadlift, awkward-object pickup, sandbag-to-shoulder, loading to platform, farmer/suitcase/bear-hug/shoulder carries, one-arm lifts, dragging, rope pulling and dead hangs.
- Heavy real-world movements use low per-session set counts because the plans retain 3 daily training exposures.
- Added authoritative Real-World Strength benchmark table with the user-defined 95%+ practical targets.
- Added direct benchmark logging. Multi-variable feats use the weakest required component for progress, so load alone cannot complete a carry standard without the required distance/time.
- Added Level 1–10 Real-World Strong milestone table across the five core certification feats. Highest fully accomplished level is highlighted.
- 315 lb is the practical deadlift benchmark; 400 lb remains a personal stretch goal.
- Legacy exercise strength targets are explicitly labeled legacy training targets rather than claimed percentiles.
- JSON import/delete supports real-world benchmark logs.

V15 THREE-A-DAY HYPERTROPHY + RECOVERY ENGINE
- Preserves v14 workout history, PRs, Legacy plans/exercises, practical-strength benchmarks and Level 1–10 logic.
- Adds per-exercise training cadence: Growth/Strength, High Fatigue/Real-World, Carry/Timed/Skill, Custom.
- Current AB3 growth movements use six productive sets per training day: AM Top+Working, Midday Top+Working, PM Back-off+Back-off. Warm-ups are separate and excluded from productive volume.
- High-fatigue movements remain one exposure/session; carries/timed/distance/skill remain one exposure/session.
- Adds exercise-specific warm-up/re-warm recommendations and logs set classification, RIR, quality, session number, volume and PR status.
- Double-progression checks Top #1 and Top #2 reps + RIR + quality; recommendations prefer newest logged sets, then PRs, then conservative base loads.
- AB3 alternates A/B/A and B/A/B, anchored to Monday 2026-09-14.
- Adds muscle-based hypertrophy dashboard with direct vs secondary set-equivalents, current-week planned/completed volume, rolling 14-day volume, customizable target zones and average RIR.
- Protein reference range defaults to 1.6–2.2 g/kg/day; target defaults to 1.8 g/kg/day. Adds 3–5 configurable protein anchors across 2–6 eating events. Collagen does not count toward complete-protein target.
- Carbs remain 3.5–5.0 g/kg/day, target 4.25 g/kg/day, with peri-workout-biased allocation.
- Creatine defaults to 5 g/day maintenance. Optional loading automatically transitions after 7 days.
- Adds energy goal modes, manual maintenance/TDEE, adjustable surplus/deficit, and macro/calorie conflict warning.
- Adds daily productive-set/volume/PR/recovery/nutrition/readiness/soreness/pump summary and Top #1 vs Top #2 recovery comparison.
- Supports 1, 2 or 3 training sessions/day.
- Migration seeds current-version PRs from existing corresponding Legacy PRs only when absent and never duplicates workout records.

V15 FINAL ACCEPTANCE
- JavaScript syntax validated with Node.
- Static acceptance checks passed for Legacy preservation, practical-strength standards, cadence types, warm-up separation, RIR progression, AB3 alternation, 14-day analytics, protein anchors, carbohydrate targeting, creatine auto-transition, energy modes, recovery analytics, muscle volume, 1–3 sessions/day, migration safety and baseline-only recommendations where history is absent.
- Default AB3 volume at 3 sessions/day:
  Week 1 A/B/A = 90 productive sets/exposures.
  Week 2 B/A/B = 90 productive sets/exposures.
  14 days = 180 productive sets/exposures.
  Each Growth exercise = 18 productive sets per 14 days.
  Each assigned High-Fatigue/Carry-Skill exercise = 9 exposures per 14 days.

V16 UI / LEGACY / LOGGING CLEANUP
- Workout logger removes warm-up rows; warm-up is assumed completed and remains excluded from productive volume.
- Set type/classification is hidden from the logger and retained internally from programming.
- Legacy Mode hides Legacy plans/exercises/workouts from regular screens and exposes them only when enabled; data is preserved.
- Schedule/detail prescriptions omit Top/Working/Back-off/Re-warm labels.
- Today’s Exercises retains detailed prescriptions and renders each productive set on a separate row, including each PM back-off.
- Exercise Volume table has a content-width sticky Exercise column for both header and names; other PR tables are unchanged.
- Main Settings uses one Meals per day control; Advanced Settings can independently separate protein anchors and eating events plus other detailed controls.

V17 SESSION DETAIL CLEANUP
- Removed the redundant RIR column from the tappable schedule workout table. RIR remains displayed inside each Prescription and remains fully stored/used by training and progression logic.

V18 SENIOR FRONTEND UI/UX AUDIT
Mobile-first improvements:
- Progress page split into Strength / Growth / Exercise PRs segmented views, reducing a very long single-page scroll while preserving all dashboards/tables.
- Explanatory copy moved into optional disclosure panels.
- Horizontal tables now show a small swipe hint on mobile.
- Today Active Preset becomes a compact disclosure instead of a full section/card.
- Today Schedule gains All / Training / Nutrition filters. Completed schedule events collapse their secondary description on mobile.
- Week strip uses short A/B/Rest-style labels where possible to fit seven columns cleanly.
- Plan days are collapsible; the current day opens automatically.
- Session-detail modal becomes a two-column Exercise + Prescription view on mobile, hiding secondary carryover copy only at narrow widths.
- Workout logger gets explicit Load / Reps-or-distance / RIR / Quality field labels and a mobile two-row set layout.
- Save Workout remains sticky near the bottom of long logging modals.
- Settings secondary areas (muscle targets, exercise configuration, data/backup) are collapsed by default.
- Modals lock background scrolling and support Escape to close.
- Bottom navigation switches to consistent inline SVG icons and scrolls the new page to the top.
- Touch targets are at least ~44 px for primary interactive controls; mobile inputs use 16px font size to avoid iOS focus zoom.
- Added stronger keyboard focus visibility and reduced-motion handling.
- App subtitle no longer assumes three sessions/day because 1/2/3 are configurable.
No training algorithms, historical data, practical-strength targets, progression rules, Legacy separation, nutrition calculations, or benchmark Level 1–10 logic were intentionally changed.

V19 WORKOUT ENTRY + COPY CLEANUP
- Workout-log RIR uses fast 0 / 1 / 2 buttons. 0 is selected by default for every logged set.
- A ••• button reveals a custom 0–10 RIR number field when another value is needed.
- RIR remains fully stored and used by progression/recovery analytics.
- Legacy programs and workout history remain separated by Legacy Mode, but movements that exist in both environments use the same user-facing exercise name rather than appearing as a second “Legacy — Exercise” identity. Historical IDs/data remain intact internally.
- Session preview adds a collapsed Warm-up section. Opening it shows the suggested warm-up only when the user wants it; the main prescription remains uncluttered.
- Session timing now uses human-friendly minutes/hours instead of decimal-hour wording.
- Workout logger removes repeated cadence/warm-up metadata from every exercise block.
- Daily macro cards show only the calculated gram goals. Formula/range/weight details move behind a question-mark disclosure.
- Schedule session-spacing guidance moves behind a question mark.
- Meal/creatine timeline copy is shortened to the information needed to execute the day.
- Progress/volume methodology remains available through question-mark disclosures instead of permanent explanatory cards.
- Daily Summary copy is shortened; calculation methodology moves behind a question-mark disclosure.
- Training algorithms, stored logs, PRs, benchmark standards, Level 1–10 logic, nutrition calculations and Legacy history are preserved.

V20 WORKOUT-TYPE EXERCISE BUILDER
- Adds a mobile-first Customize Workout Exercises panel to Plan.
- Workout days are grouped into shared workout types. Examples: both "Upper strength + carry" and "Upper hypertrophy + rope pull" belong to the Upper type; legs/hinge days belong to Lower; AB3 keeps Functional A and Functional B distinct.
- Builder uses two stacked tappable lists: Exercises in workout and Exercises not in workout, with ↓ Remove and ↑ Add controls.
- A change applies to every day and active session of that workout type, not a single calendar day.
- Existing preset programming remains unchanged until the user makes the first edit to a workout type. The first edit intentionally syncs the displayed exercise list across all days of that type.
- Reset Workout Type removes the override and restores the preset's original exercise membership.
- Builder controls membership only. It does not expose sets, reps, RIR or load controls.
- Adds New Exercise flow with name, logging method and training style. New exercises start without a fabricated PR/load and can be added with the same builder.
- Custom exercises and workout-type overrides are persisted, exported/imported in JSON, and available in selective data deletion.
- Existing workouts, PRs, practical-strength benchmarks, Legacy history, nutrition settings and all prior v19 data remain intact.

V21 FOOD & NUTRITION LOG
- Adds a fifth bottom-navigation tab: Food.
- Adds quick-log nutrition references for 85/15, 93/7 and 96/4 ground beef; shredded chicken breast; one large egg; Goya black beans; Goya kidney beans; green peas; broccoli florets; spinach; and kale.
- The standard scoop is 4 fluid ounces by volume (1/2 US cup), using cooked/drained reference weights where applicable. Egg uses one large cooked egg.
- Each food shows calories, protein, carbohydrate, fat and fiber per base serving.
- Quantity can be adjusted in 0.25-serving increments or typed directly before logging.
- Daily Food summary totals calories, protein, carbs, fat and fiber; protein/carbohydrate/calorie targets appear when available.
- Today's food log shows each quantity and scaled macros and allows individual deletion.
- Food entries store a nutrition snapshot so historical logs do not silently change if reference data is adjusted later.
- Food logs are included in normal JSON exports and can be selectively imported or deleted.
- Today's existing Nutrition summary uses actual food-log totals when food has been logged; otherwise it continues to show planned targets.
- Goya bean macros use Goya's current 1/2-cup label values. Other values are based on USDA cooked-food references. The 96/4 cooked-beef entry is an estimate from adjacent USDA cooked lean percentages because an exact cooked 96/4 reference was not available.

V22 FOOD CATALOG EXPANSION
- Adds Premier Protein Shake as one Food item with flavor selection:
  Strawberry; Cookies & Cream; Café Latte; White Chocolate Indulgence; Strawberry Chocolate Indulgence.
- Premier shake logging uses one full 11.5 fl oz shake per quantity unit rather than a 4 fl oz scoop.
- Flavor-specific calories/macros update on the card before logging and the chosen flavor is stored in the historical nutrition snapshot.
- White Chocolate Indulgence maps to Premier Protein's current White Chocolate Raspberry Indulgence label.
- Strawberry Chocolate Indulgence maps to Premier Protein's current Chocolate Covered Strawberry Indulgence label.
- Adds cooked jasmine rice at a 4 fl oz / 1/2-cup scoop reference.
- Adds Bumble Bee Solid White Albacore Tuna in Water, drained, at a 4 fl oz / 1/2-cup scoop reference.
- Adds plain lowfat kefir at a 4 fl oz / 1/2-cup (120 mL) reference.
- Adds Kirkland Signature plain nonfat Greek yogurt at a 4 fl oz / 1/2-cup reference.
- Quantity modifiers, food-log totals, historical snapshots, JSON import/export and selective deletion continue to work with the new items.

V23 FOOD SEARCH + COPY CLEANUP
- Adds live Quick Log search. Search matches food names, supporting notes/brands and Premier Protein flavor names.
- Search is case-insensitive and accent-insensitive; a clear button appears when text is entered.
- Food & Nutrition help (?) stays aligned with the page heading on mobile instead of dropping to its own row.
- Removes redundant "logged" labels below Calories, Fat and Fiber summary cards.
- Removes repetitive "Tap to mark complete" language from Today schedule items; tapping still toggles completion.
- Removes the unnecessary Quick Log instruction line.
- Keeps all five bottom-navigation items on one row on mobile.
- No food nutrition values, historical logs, training data, nutrition targets or progression logic are changed.

V24 LIVE FOOD QUANTITY NUTRITION
- Quick Log food cards now recalculate immediately whenever quantity changes.
- Calories, protein, carbs, fat and fiber all scale live before the item is logged.
- The serving line also scales live:
  * Scoop foods show quantity, total fluid ounces and approximate total grams.
  * Premier Protein shows shake count, total fluid ounces and approximate grams.
  * Egg shows egg count and approximate grams.
  * Kefir also shows scaled milliliters.
- Live updates work with minus/plus buttons and directly typed quantities.
- Premier flavor changes continue to update nutrition and now use the current quantity at the same time.
- Logged entries still store a fixed nutrition snapshot and historical food data is unchanged.

V25 PLAN OVERFLOW + FOOD LIBRARY + MEALS
- Plan day session blocks now have reliable horizontal scrolling for long single-line prescriptions at mobile and desktop widths.
- Adds horizontal inset/padding inside each expanded day so session blocks no longer sit directly against the day-card edges.
- Today's Exercises warm-up line keeps one "Warm-up:" label and strips redundant internal WARM-UP / RE-WARM labels.
- Every Quick Log food now has Edit. Built-in foods can be overridden without changing historical logs; Restore default removes the override.
- Adds New food with editable name, serving, grams, calories, protein, carbs, fat, fiber and notes.
- User-created foods can be edited/deleted and participate in Food search, Quick Log and meals.
- Adds saved Meals: create a meal, add multiple foods with quantities and Premier flavor selection, edit/delete the definition, and log the full meal with one tap.
- Logging a meal writes each ingredient to the existing food log with a meal label and fixed nutrition snapshot, preserving accurate daily totals and history.
- Food edits, custom foods and saved meals participate in JSON import/export and selective data deletion.
- Existing food logs, workout history, PRs, programs, benchmarks, nutrition settings and all prior data remain backward-compatible.

V26 TYPOGRAPHY + WARM-UP FIX
- Disables Safari/iOS automatic text inflation with text-size-adjust: 100% so rows inside horizontally scrollable Plan cards no longer get unpredictably enlarged.
- Normalizes Plan exercise names and prescriptions to the same 13px size and 1.4 line height across rows/sessions; weight/color hierarchy remains, but text no longer jumps in size.
- Normalizes the app's form/control font family to the same system/Inter font stack.
- Removed an obsolete duplicate renderTodayExercises function that was overriding the newer implementation at runtime.
- Today's Exercises now uses only the current renderer and shows a single "Warm-up:" prefix; internal WARM-UP / RE-WARM labels are stripped from the displayed warm-up steps.
- Existing Plan horizontal scrolling/padding, Food editing, saved meals, food logs, workouts, PRs, benchmarks and historical data remain unchanged.

V27 STRENGTH LEVEL ELITE STANDARDS
- Researched current Strength Level male age-30 Elite standards and adds them to Exercise PR rows where there is a direct or clearly corresponding exercise standard.
- Strength Level defines Elite as stronger than 95% of lifters.
- Added age-30 male Elite goals:
  * Dumbbell Shoulder Press: 121 lb/hand 1RM
  * Dumbbell Row: 171 lb/arm 1RM
  * Push Ups: 87 strict reps
  * Dumbbell Curl: 93 lb/hand 1RM
  * Dumbbell Concentration Curl: 88 lb/arm 1RM
  * Dumbbell Shrug: 188 lb/hand 1RM
  * Dumbbell Calf Raise: 178 lb external dumbbell load 1RM
  * Dumbbell Floor Press: 140 lb/hand 1RM
  * Pull Ups: 30 strict reps
  * Dumbbell Wrist Curl: 126 lb/arm 1RM
  * Goblet Squat: 174 lb 1RM
  * Dumbbell Romanian Deadlift: 173 lb/hand 1RM
  * Dumbbell Split Squat: 137 lb/hand 1RM
- App-specific movements without an exact Strength Level match are explicitly labeled instead of receiving an inferred standard: KB Swing, single-arm DB triceps extension, behind-the-back DB wrist curl, weighted throwing punches.
- Existing real-world practical benchmarks remain unchanged and separate from Strength Level exercise standards.
- Strength Level 1RM goals use their published 1RM directly in progress calculations instead of applying a second Epley conversion.
- Current Dumbbell Calf Raise comparison uses external added dumbbell load for estimated 1RM/progress so it is comparable to Strength Level's dumbbell-load standard; bodyweight is not incorrectly added to the published standard.

V28 COLLAPSIBLE / EDITABLE FOOD CATEGORIES
- Quick Log is grouped into collapsible food categories when search is empty.
- Default categories are Protein, Carbs and Other. Protein is first/open by default; the remaining categories are collapsed until opened.
- Default assignments:
  Protein: ground beef, chicken, egg, Premier Protein, Bumble Bee albacore tuna, kefir, Kirkland Greek yogurt.
  Carbs: jasmine rice, Goya black beans, Goya kidney beans, green peas.
  Other: broccoli, spinach and kale.
- When the Food search field contains a query, categories disappear and matching foods render as one flat result list.
- Adds Categories editor: rename/reorder categories, create new categories, and delete non-Other categories. Foods from deleted categories move to Other.
- Every Food editor now includes a Category selector, so built-in and custom foods can be reassigned.
- Food category definitions and assignments persist in app state, normal JSON export/import, and selective data deletion.
- Restoring a built-in food to default also restores its default category.
- Existing food logs and historical nutrition snapshots are not modified by category changes.

V29 NUTRITION RE-AUDIT
- Rechecked all built-in Quick Log nutrition references against current manufacturer labels and USDA reference data.
- Corrected 93/7 beef, estimated 96/4 beef, kale and cooked jasmine rice.
- Clarified Green Peas as the USDA frozen/cooked/drained reference and corrected carb precision.
- Clarified brand/source provenance for Goya beans, Bumble Bee tuna, Lifeway kefir, Kirkland Greek yogurt and cooked chicken.
- Premier Café Latte and White Chocolate Raspberry labels report <1g fiber; numeric estimates are documented for daily fiber totaling.
- Removed unsupported approximate gram mass from Premier shake display; shakes remain logged as 11.5 fl oz units.
- Historical food logs keep their stored nutrition snapshots and are not silently rewritten by the new reference values.
- See NUTRITION_AUDIT_v29.txt for the audit summary.

V30 CUSTOM FOOD QUANTITY INCREMENTS
- Adds Quantity increment to the Food editor for every built-in and custom food.
- Existing foods default to 0.25-serving increments unless customized.
- Premier Protein Shake defaults to an increment of 1, so its +/- controls move 1 shake at a time and entered/logged quantities snap to whole-shake increments.
- Quick Log +/- buttons now read each food's configured increment instead of using a universal 0.25.
- Quantity inputs expose the matching HTML min/step and snap to the configured increment on change and when logging.
- Live ounces/grams/calories/macros continue to update while quantity is being edited.
- Saved Meal ingredient quantities use the selected food's increment too; Premier shakes in meals therefore use whole-shake quantities.
- Built-in Food increment edits persist through foodOverrides; custom-food increments persist with the custom Food definition. Restore Default restores the built-in increment.
- Existing historical food logs and saved meal quantities are not rewritten.

V31 ADD SET WHILE LOGGING
- Every exercise in the workout logger now has a + Add set button.
- Added sets copy the previous set's load/reps structure so entering an unplanned extra set is fast.
- Added-set RIR starts at 0, matching the app's normal logging default, and retains the 0 / 1 / 2 / custom RIR control.
- Added sets inherit the preceding programmed set classification internally so hypertrophy/recovery analytics remain consistent (for example, an extra evening back-off remains a back-off rather than silently becoming a different set type).
- Added sets count as productive volume and can update PRs using the same rules as normal logged sets.
- Each manually added set has Remove set before the workout is saved.
- Removing a set automatically renumbers the remaining set rows.
- Existing programmed sets, workout plans, historical logs and progression logic are unchanged.

V32 PRESCRIPTION + SCHEDULE EDITORS
- Workout logger default RIR is now 1 instead of 0, including newly added sets. The 0 / 1 / 2 / custom control remains available.
- Adds a dedicated Plan > Customize prescriptions editor:
  * choose workout type, exercise and session;
  * edit the exact number of sets/exposures;
  * add/remove planned sets;
  * edit min/max reps (or feet/seconds), min/max RIR, and internal set type;
  * choose load rule per set: Auto, % Top, or Fixed load;
  * reset one session or all prescriptions for the selected exercise/workout type.
- Prescription overrides apply to every matching day of that workout type, feed Today/Plan/session views, populate the workout logger, and flow into planned-volume analytics.
- Auto load retains the existing progression engine. % Top scales from the current recommended top load. Fixed suggests the entered load while logged results remain editable.
- Adds Settings > Schedule & eating window:
  * Morning, Midday and Evening workout times are editable.
  * Eating window is optional and OFF by default; stored defaults are 10:00–19:00.
  * When enabled, workout times remain fixed anchors and meals are fitted inside the window as close as practical to ~60 minutes pre / ~45 minutes post workout.
  * Meals are kept in sequence with practical spacing if multiple desired meal times collide at a window boundary.
  * Creatine loading doses are distributed through the eating window when enabled; maintenance creatine follows the first scheduled meal.
  * 24-hour / military time is optional and OFF by default; normal display uses AM/PM.
- Today schedule is now sorted by numeric clock time rather than string order. At identical times, workouts display before meals, then supplements.
- Custom prescriptions are included in JSON export/import and selective data deletion.
- Historical workout logs, food logs, saved meals, nutrition audit data and all existing PR/benchmark history remain unchanged.

V32 PROGRAMMING + SCHEDULE EDITORS
- Workout logging now defaults RIR to 1, including manually added sets. 0 / 1 / 2 / custom RIR remains available.
- Adds Plan > Customize prescriptions, separate from exercise membership editing.
- Prescription editing is scoped by Workout Type + Exercise + Session so recurring days stay consistent without editing each calendar day manually.
- Prescription editor supports adding/removing productive sets/exposures, min/max reps (or distance/time), min/max RIR, and per-set load rules.
- Load rule options:
  * Auto: existing progression/recommendation engine.
  * % Top: percentage of the exercise's current recommended top load, rounded to the configured practical increment.
  * Fixed: fixed suggested external load.
- Custom prescriptions feed Plan display, session preview, warm-up anchor load and workout logging; actual logged performance remains freely editable.
- Adds per-session reset and per-exercise prescription reset. Custom prescriptions are included in JSON import/export and selective deletion.
- Adds Settings > Schedule & eating window.
- Morning, Midday and Evening workout anchor times are user-editable.
- Optional eating window defaults to 10:00 AM–7:00 PM when enabled. Workout anchors are preserved; scheduled meals are moved inside the eating window and kept as close as practical to their pre/post-workout targets.
- The Today schedule is numerically sorted by actual time. If events share a time, workout appears before food, then supplements.
- AM/PM display is the default. Optional 24-hour / military-time display changes formatting only.
- Eating-window validation prevents same-day end times at or before the start time.
- Existing workouts, PRs, food logs, meals, Food categories, nutrition data, custom quantity increments, Strength Level standards and historical data remain unchanged.
