# AMOLED Overlay Extension (WIP)

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
INACTIVITY_MS    = 2000; //Delay with no mouse movement over the panel before the overlay appears(ms)
FADE_TIME_MS     = 1000; // Duration of the overlay's fade-in animation(ms)
INIT_DELAY_S     = 6;    // Initial delay before positioning the overlay(sec)
UNLOCK_DELAY_S   = 6;    // Delay after unlocking the screen before repositioning the overlay(sec)
INACTIVE_OPACITY = 0;    // Opacity of the transparent overlay (0–255). 0 = fully transparent
INIT_RETRIES     = 3;    // Number of times to retry positioning the overlay if it fails
OVERLAY_COLOR    = '#000000'; // Background color of the overlay. Use #000000 for pure black (AMOLED display).

B_JITTERX        = 180;  // The maximum horizontal offset by which the container can randomly shift left or right from its base position(px).

DATE_MARGIN      = 6;    //Space between clock and date(px)
USER_MARGIN      = 6;    // Space between battery and username(px)

SHOW_CLOCK       = true;
SHOW_DATE        = true;
SHOW_BATTERY     = true; //Battery info with charging status
SHOW_USERNAME    = true;
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
Tested under Gnome 48

