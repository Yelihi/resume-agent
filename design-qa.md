# Design QA

이 문서는 2026-09-07 시각 검증 기록이다. 이후 검토 출처·자료 근거 표시와 2026-09-10 저장 계약 변경을 이 시각 검증에 포함된 것으로 해석하지 않는다. 현재 기능·검증 기준은 DESIGN_NOTES.md와 PHASE_3_CONTEXT.md를 참고한다.

- Source visual truth: `/Users/yelihi/.codex/generated_images/01a05177-9ead-7bf1-9341-ab3dd3cc5452/exec-7e05c842-9a73-4789-a4a8-54f0576f07db.png`
- Implementation screenshot: `/Users/yelihi/Documents/resume agent project/implementation-ui-final-matched.png`
- Viewport: 1487 × 1058 CSS px
- Pixel dimensions: source 1487 × 1058; implementation 1487 × 1058
- Density normalization: both compared at matching native pixel dimensions; browser screenshot used device scale 1
- State: desktop, resume ready, file input selected, job-posting drawer open. The source contains illustrative review results and attachments; the implementation intentionally shows the current local empty-review state rather than fabricating persisted data.

## Findings

- No actionable P0/P1/P2 differences remain. The selected direction is preserved: compact dark navigation rail, restrained blue accent, document-first workspace, separate review column, and a right-side reference drawer above the workspace.
- Typography uses the existing Korean-first Pretendard/system stack with compact hierarchy and neutral weights. It is slightly less condensed than the generated reference but remains within P3 polish.
- Spacing and layout rhythm now match the reference proportions closely: 136 px navigation rail, flexible document area, 340 px review column, and 328 px drawer at the target viewport.
- Colors and tokens match the source's charcoal, cool-gray, white, and cobalt roles. Gradients and glass effects are absent.
- Icons use the Phosphor vector icon library; no raster placeholders, emoji, handwritten SVG, or CSS-drawn icons are used. The reference has no required photographic or illustrative assets.
- Copy is adapted to the real product states and existing domain language. Source-only fictional resume and company data were not copied into the application.

## Full-view comparison evidence

The source and final implementation were opened together at the same pixel dimensions. Main-region proportions, drawer hierarchy, toolbar density, border rhythm, restrained elevation, and accent placement align. The implementation keeps the drawer fixed above the app while reserving desktop space so the review column remains visible, matching the selected visual without losing the requested overlay behavior.

## Focused region comparison evidence

A separate crop was not needed because both native-size 1487 × 1058 artifacts keep the toolbar, navigation, drawer controls, typography, and borders legible in the full-view comparison. The drawer was additionally inspected in its job-posting and company-information states.

## Comparison history

1. First pass — blocked
   - Evidence: `implementation-ui-pass1.png` at 1440 × 1024.
   - P2 findings: the drawer scrim was too dark, the drawer hid the full review column, programmatic focus created a prominent close-button outline, and the file action row stretched vertically.
   - Fixes: reduced scrim opacity, moved initial focus to the dialog container, corrected the file-label layout, reserved desktop space for the fixed drawer, and aligned rail/review/drawer widths to the source.
2. Final pass — passed
   - Evidence: `implementation-ui-final-matched.png` at 1487 × 1058.
   - Post-fix result: navigation, viewer, review, and drawer remain simultaneously visible with proportions matching the source. Drawer tabs and close behavior work, and the mobile layout has no horizontal overflow.

## Interaction and runtime checks

- Opened and closed the reference drawer; focus returned to the trigger.
- Switched between job-posting and company-information tabs.
- Switched resume input modes without losing the rendered resume.
- Checked the 390 × 844 responsive state: body, shell, and viewer widths remained 390 px with no horizontal overflow.
- Browser console errors: none.
- Frontend tests: 33 passed.
- Production build: passed.

## Follow-up polish

- P3: compare the populated analysis state after the user runs a real review; the generated reference uses fictional results that were deliberately not persisted.

final result: passed
