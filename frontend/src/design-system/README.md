# Shared UI foundations

`tokens.css` is the single source for the existing palette, font families, repeated text sizes, spacing scale, radii and modal backdrop/shadow. `styles.css` imports these tokens and applies them to the current screens; dimensions for document rendering and responsive breakpoints remain local.

Use semantic colors (`--accent`, `--danger`, `--muted`, `--surface`) and the existing size/spacing tokens before adding values. Keep unique document layout measurements local. All explicit UI font sizes use the shared scale. Metadata has a minimum size of `--text-xs` (0.75rem); body and headings use the larger tokens, with `--text-title` preserving the existing 21px page title at the default root size. The eyebrow label uses `--muted` for readable contrast. This intentionally increases previously smaller metadata; responsive visual validation remains pending because a browser runtime was unavailable.

`components/Dialog.tsx` is a mounted-open native modal. Provide `labelledBy` referencing a visible heading and `onDismiss` to remove it. Set `busy` to prevent Escape during persistence; disable the corresponding action buttons too. Native dialogs contain keyboard focus and make the background inert. The component restores the opener's focus on unmount. Close controls call `onDismiss`; do not close the native element independently.

Global styles supply keyboard focus rings (including select and details/summary), modal scroll locking and reduced-motion behavior. Unit tests cover dismissal and focus restoration; browser validation is required for native Tab containment and stacked modal behavior, which jsdom cannot reproduce.
