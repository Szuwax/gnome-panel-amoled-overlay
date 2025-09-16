AMOLED Overlay Extension

A GNOME Shell extension that places a black overlay on the top panel/dash to panel to reduce the risk of OLED burn-in.
It displays a small digital clock that periodically shifts its horizontal position to prevent static burn-in.




Features:
~~~
Black transparent overlay on the top panel/dash to panel to reduce OLED burn-in
Digital clock that periodically shifts horizontally to prevent static burn-in
Overlay appears after a period of mouse inactivity
Smooth fade-in animation when overlay is activated
Clock automatically updates every minute
Overlay hides and resets when:
  mouse moves over the panel
  a system notification appears
Repositions itself when:
  screen is unlocked (with delay)
  monitors configuration changes (e.g. external display)

Retries several times to attach correctly after startup, with safe fallback if it fails
Optional bundled custom font (Matrixtype) for the clock, or system default
~~~
Configuration:
You can edit constants directly in extension.js to customize behavior:
~~~
const INACTIVITY_MS   = 2000; // Mouse inactivity before overlay appears (ms)
const FADE_TIME_MS    = 1000; // Fade-in duration (ms)
const INIT_DELAY_MS   = 6000; // Delay before initial positioning (ms)
const UNLOCK_DELAY_MS = 6000; // Delay after unlocking before reposition (ms)
const ACTIVE_OPACITY  = 0;    // Overlay opacity (0–255)
const INIT_RETRIES    = 3;    // Number of retries for positioning

// Clock
const CLOCK_COLOR        = '#006600'; // Clock text color
const CLOCK_SIZE         = 18;        // Clock text size (px)
const CLOCK_JITTERX      = 45;        // Max horizontal shift (px)
const CLOCK_MARGIN_RIGHT = 60;        // Distance from right edge (px)
const USE_CUSTOM_FONT    = true;      // Use bundled font (Matrixtype) or system default
~~~
Installation:
~~~
1.Clone this repository into your GNOME extensions folder
2.Restart GNOME Shell:
3.Enable the extension via Extensions mng
~~~
