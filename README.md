# AMOLED Overlay Extension (WIP)

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
- Optional custom font (Matrixtype) for the clock, or system default  
  - Download and install (Display Regular Style font): [Matrixtype Display Regular](https://www.fontspace.com/matrixtype-font-f125326)



Configuration:

You can edit constants directly in extension.js to customize behavior:
~~~
const INACTIVITY_MS    = 2000; // Delay with no mouse movement before overlay appears(ms).
const FADE_TIME_MS     = 1000; // Duration of fade-in animation(ms).
const INIT_DELAY_MS    = 6000; // Initial delay before positioning overlay(ms).
const UNLOCK_DELAY_MS  = 6000; // Delay after unlocking screen before repositioning overlay(ms).
const INACTIVE_OPACITY = 0;    // Overlay opacity when inactive (0-255). 0 = fully transparent
const INIT_RETRIES     = 3;    // Number of retries if initial positioning fails.
const OVERLAY_COLOR    = '#000000'; // Overlay background color. Use #000000 dor AMOLED display.

// Clock
const CLOCK_JITTERX      = 70;   // Max horizontal jitter(px).
const CLOCK_MARGIN_RIGHT = 150;  // Distance from right edge(px). Increased for clock+date

// Date
const DATE_MARGIN   = 8;      // Space between clock and date(px)
const DATE_US_STYLE = false;  // false -DD.MM.YY, true -MM.DD.YY
~~~
You can edit font color and font size in stylesheet.css


Installation:

1.Create the extension folder:
```
mkdir -p ~/.local/share/gnome-shell/extensions/amoled-overlay@Szu
```

2. Copy all files from this repository into that folder (Download ZIP from GitHub and extract, or copy manually).

3.Restart GNOME Shell

4.Enable the extension via Extensions mng


##
This extension is a personal project I made for my own use, so I don't plan to publish (but who knows) it on the GNOME Extensions site. It works well for my setup, so I probably won't be actively maintaining it or fixing bugs, but I do expect to make gradual improvements over time.

I originally had no plans to upload this, but maybe it will be useful to someone else.

