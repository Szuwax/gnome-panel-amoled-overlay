# AMOLED Overlay Extension

Hiding the panel on an AMOLED screen felt annoying. For me it was more convenient to keep the panel always visible with a small height and simply make it turn fully black when not in use.  
That’s why this extension was created.

Black overlay on the top panel/dash to panel to reduce the risk of OLED burn-in.
It displays a small digital clock that periodically shifts its horizontal position to prevent static burn-in.

![Overlay with clock](ss/1.png)
![wITHOUT OVERLAY](ss/2.png)
## Features

- Black overlay on the top panel/Dash to Panel to reduce OLED burn-in  
- Digital clock that periodically shifts horizontally to prevent static burn-in  
- Overlay appears after a period of inactivity **when the mouse is not over the panel**  
- Smooth fade-in animation when overlay is activated  
- Clock automatically updates every minute  
- Overlay hides when:
  - Mouse moves over the panel  
  - A system notification appears  
- Repositions when:
  - Screen is unlocked (with delay)  
  - Monitors configuration changes 
- Retries several times to attach correctly after startup, with safe fallback if it fails  
- Optional bundled custom font (Matrixtype) for the clock, or system default  
  - Download and install: [Matrixtype Display Regular](https://www.fontspace.com/matrixtype-font-f125326)



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

1.Clone this repository into your GNOME extensions folder:
~~~
git clone https://github.com/Szuwax/gnome-panel-amoled-overlay ~/.local/share/gnome-shell/extensions/amoled-overlay@Szu
~~~
2.Restart GNOME Shell
3.Enable the extension via Extensions mng



##
This extension is a personal project I made for my own use, so I don't plan to publish it on the GNOME Extensions site. It works well for my setup, so I probably won't be actively maintaining it or fixing bugs unless I decide to add new features later on.
Still, Im open for suggestions and ideas for how to make it better
