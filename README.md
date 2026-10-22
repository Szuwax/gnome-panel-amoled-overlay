# AMOLED Overlay Extension - Gnome 50 (WIP)

Hiding the panel on an AMOLED screen felt annoying. For me it was more convenient to keep the panel always visible with a small height and simply make it turn fully black when not in use.  
That’s why this extension was created.

Black overlay on the top panel/dash to panel to reduce the risk of OLED burn-in.
It displays a small digital clock that periodically shifts its horizontal position to prevent static burn-in.

![Overlay with clock](ss/3.png)
## Features

- Black overlay on the top panel/Dash to Panel to reduce OLED burn-in  
- Digital clock with date, battery status an username that periodically shifts horizontally to prevent static burn-in  
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
// Settings
INACTIVITY_MS    = 2000; // Delay with no mouse movement before overlay appears (ms)
FADE_TIME_MS     = 1000; // Duration of fade-in animation (ms)
INIT_DELAY_S     = 8;   // Initial delay before positioning overlay (sec)
UNLOCK_DELAY_S   = 8;   // Delay after unlocking before repositioning overlay (sec)
INIT_RETRIES     = 3;    // Retry count for repositioning overlay
INACTIVE_OPACITY = 0;    // Fully transparent overlay opacity
OVERLAY_COLOR    = '#000000'; //Overlay background color (pure black for AMOLED)

// Containers position
LEFT_RATIO  = 0.25; // Left container base position
RIGHT_RATIO = 0.75; // Right container base position

B_JITTERX   = 180;  // Max horizontal offset for jitter effect (px)

// Text spacing
DATE_MARGIN = 6;    //Space between clock and date (px)
USER_MARGIN = 6;    // Space between battery and username (px)

SHOW_CLOCK    = true;
SHOW_DATE     = true;
SHOW_BATTERY  = true;  // Battery info with charging status
SHOW_USERNAME = true;


REQUIRE_BUILTIN_ONLY = true; // Disable when an external monitor is connected

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
This extension is a personal project I made for my own use. It works well for my setup, so I probably won't be actively maintaining it or fixing bugs, but I do expect to make gradual improvements over time.

I originally had no plans to upload this, but maybe it will be useful to someone else.

